(function () {
  'use strict';

  const A = window.Acustica;
  const CHAVE = 'pifano.v1';
  const VAO_MAX_DEDOS = 35; // mm entre furos vizinhos da mesma mão
  const TEMPERATURA = 30; // °C do ar dentro do pífano enquanto se toca

  // ---------- utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  };
  const fmt = (v, d = 0) =>
    v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const mm = (v, d = 0) => (v == null || !isFinite(v) ? '—' : fmt(v, d) + ' mm');
  const hz = (v) => fmt(v, 1) + ' Hz';
  const sinal = (c, d = 0) => (Math.round(c * 10 ** d) >= 0 ? '+' : '−') + fmt(Math.abs(c), d);
  const arred05 = (v) => Math.round(v * 2) / 2;
  const valor = (v) => (v == null ? '' : String(v).replace('.', ','));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- projetos ----------
  function novoProjeto(nome) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      nome: nome || 'Meu pífano',
      criado: new Date().toISOString(),
      nota: 9, oitava: 4, la4: 440,
      afinacao: 'temperada', desvios: [0, 0, 0, 0, 0, 0, 0],
      dTopo: null, dPe: null, parede: null,
      rolha: null, embDiam: null, embFeito: false,
      comprimento: null, compFeito: false, deltaEmb: 0, alvoComp: null,
      furos: Array.from({ length: 6 }, () => ({
        diamPlan: null, posReal: null, diamReal: null,
        feito: false, pos: null, diam: null, erro: 0, alvo: null,
      })),
      corrigir: true,
      passo: 0,
    };
  }

  function completar(dados) {
    const base = novoProjeto();
    const p = Object.assign(base, dados);
    p.furos = base.furos.map((h, i) => Object.assign(h, (dados.furos || [])[i]));
    return p;
  }

  function carregar() {
    try {
      const b = JSON.parse(localStorage.getItem(CHAVE));
      if (b && b.projetos && Object.keys(b.projetos).length) {
        for (const id in b.projetos) b.projetos[id] = completar(b.projetos[id]);
        if (!b.projetos[b.atual]) b.atual = Object.keys(b.projetos)[0];
        return b;
      }
    } catch (e) { /* armazenamento indisponível ou corrompido */ }
    const p = novoProjeto();
    return { atual: p.id, projetos: { [p.id]: p } };
  }

  let banco = carregar();
  const proj = () => banco.projetos[banco.atual];
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(banco)); } catch (e) { /* sem armazenamento */ }
  }

  // ---------- etapas ----------
  const PASSOS = [
    { id: 'tom', rot: 'Tom' },
    { id: 'bambu', rot: 'Bambu' },
    { id: 'emb', rot: 'Embocadura' },
    { id: 'comp', rot: 'Comprimento' },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: 'furo', i, rot: 'Furo ' + (i + 1) })),
    { id: 'resumo', rot: 'Resumo' },
  ];

  function passoFeito(p, k) {
    const s = PASSOS[k];
    if (s.id === 'tom') return true;
    if (s.id === 'bambu') return p.dTopo != null && p.parede != null;
    if (s.id === 'emb') return p.embFeito;
    if (s.id === 'comp') return p.compFeito;
    if (s.id === 'furo') return p.furos[s.i].feito;
    return false;
  }

  // ---------- cálculo ----------
  let cache = { chave: null, plano: null, previsoes: null };

  function plano() {
    const p = proj();
    const chave = JSON.stringify([
      p.nota, p.oitava, p.la4, p.desvios, p.dTopo, p.dPe, p.parede, p.rolha, p.embDiam,
      p.compFeito, p.comprimento, p.deltaEmb, p.corrigir,
      p.furos.map((h) => [h.diamPlan, h.feito, h.pos, h.diam, h.erro]),
    ]);
    if (cache.chave !== chave) cache = { chave, plano: calcular(p), previsoes: null };
    return cache.plano;
  }

  function calcular(p) {
    const gas = A.ar(TEMPERATURA);
    const midi = (p.oitava + 1) * 12 + p.nota;
    const alvos = A.alvos({ midi, la4: p.la4 || 440, desvios: p.desvios });
    const meiaOnda = gas.c / (2 * alvos[0]) * 1000;
    const faixa = [meiaOnda / 32, meiaOnda / 22];
    const dTopo = p.dTopo || arred05(meiaOnda / 26);
    const dPe = p.dPe || dTopo;
    const sug = { rolha: Math.round(dTopo), emb: arred05(0.6 * dTopo) };
    const geo = {
      dTopo, dPe,
      parede: p.parede || 3,
      rolha: p.rolha || sug.rolha,
      embDiam: p.embDiam || sug.emb,
      deltaEmb: p.compFeito ? p.deltaEmb : 0,
      comprimento: p.compFeito ? p.comprimento : meiaOnda * 0.88,
      furos: [],
    };
    const diamSugerido = (x) => Math.min(11, Math.max(5, arred05(0.6 * A.diametroEm(geo, x))));
    geo.furos = p.furos.map((h, i) => (h.feito
      ? { pos: h.pos, diam: h.diam }
      : { pos: 0, diam: h.diamPlan || diamSugerido(geo.comprimento * (0.85 - 0.1 * i)) }));

    const info = p.furos.map(() => ({}));
    const pl = { gas, midi, alvos, meiaOnda, faixa, dTopo, dPe, sug, geo, info, falhou: false };

    // Duas voltas: na segunda, cada furo já "enxerga" os furos de cima (fechados).
    for (let volta = 0; volta < 2; volta++) {
      if (!p.compFeito) {
        const L = A.resolverComprimento(geo, alvos[0], gas);
        if (L == null) { pl.falhou = true; return pl; }
        geo.comprimento = L;
      }
      let erro = 0;
      for (let i = 0; i < 6; i++) {
        const h = p.furos[i];
        if (h.feito) { erro = p.corrigir ? h.erro || 0 : 0; continue; }
        const alvoModelo = alvos[i + 1] * Math.pow(2, erro / 1200);
        const dMax = Math.min(12, arred05(0.85 * A.diametroEm(geo, geo.comprimento * 0.6)));
        let r = A.resolverFuro(geo, i, alvoModelo, gas);
        if (!h.diamPlan) {
          while (r.fora === 'alto' && geo.furos[i].diam < dMax) {
            geo.furos[i].diam += 0.5;
            r = A.resolverFuro(geo, i, alvoModelo, gas);
          }
        }
        geo.furos[i].pos = r.x;
        info[i] = { fora: r.fora, erro };
      }
    }

    // Alvos para o afinador durante a construção: os furos de cima ainda não
    // existem, e quando existirem (fechados) vão baixar levemente a nota.
    const f0Final = A.ressonancia(geo, 0, gas, alvos[0]);
    const f0Sem = A.ressonancia({ ...geo, furos: [] }, 0, gas, alvos[0]);
    pl.alvoComp = alvos[0] * f0Sem / f0Final;
    for (let i = 0; i < 6; i++) {
      if (p.furos[i].feito) continue;
      const fF = A.ressonancia(geo, i + 1, gas, alvos[i + 1]);
      const fC = A.ressonancia({ ...geo, furos: geo.furos.slice(0, i + 1) }, i + 1, gas, alvos[i + 1]);
      info[i].alvoAfinador = alvos[i + 1] * fC / fF;
    }
    pl.margem = Math.max(10, 0.03 * geo.comprimento);
    pl.gomo = geo.rolha + geo.comprimento + pl.margem;
    return pl;
  }

  function previsoes(pl) {
    if (!cache.previsoes) {
      cache.previsoes = pl.alvos.map((alvo, n) => {
        const f1 = A.ressonancia(pl.geo, n, pl.gas, alvo);
        const f2 = A.ressonancia(pl.geo, n, pl.gas, alvo, 2);
        return { alvo, f1, f2 };
      });
    }
    return cache.previsoes;
  }

  function nomeGrau(pl, k) {
    const x = pl.midi + A.ESCALA_MAIOR[k] + proj().desvios[k] / 100;
    const resto = Math.round((x - Math.round(x)) * 100);
    return A.nomeMidi(x) + (resto ? ` ${sinal(resto)}¢` : '');
  }

  function dedilhado(n, mini) {
    let b = '';
    for (let j = 6; j >= 1; j--) b += `<i class="${j > n ? 'fechado' : ''}${j === 3 ? ' gap' : ''}"></i>`;
    return mini
      ? `<span class="dedilhado mini"><span class="bolinhas">${b}</span></span>`
      : `<div class="dedilhado"><span>emb.</span><span class="bolinhas">${b}</span><span>pé</span></div>`;
  }

  // ---------- conteúdo de cada etapa ----------
  // html(p): monta a etapa (uma vez); saidas(p, pl): valores calculados.
  const ETAPAS = {
    tom: {
      html(p) {
        const notas = A.NOMES.map((n, k) => `<option value="${k}" ${k === p.nota ? 'selected' : ''}>${n}</option>`).join('');
        const oitavas = [3, 4, 5, 6].map((o) => `<option value="${o}" ${o === p.oitava ? 'selected' : ''}>${o}</option>`).join('');
        const modelos = Object.entries(A.AFINACOES)
          .map(([k, a]) => `<option value="${k}" ${k === p.afinacao ? 'selected' : ''}>${a.nome}</option>`).join('')
          + `<option value="personalizada" ${p.afinacao === 'personalizada' ? 'selected' : ''}>Personalizada</option>`;
        const linhas = A.GRAUS.map((g, k) => `
          <tr><td>${g}</td><td data-s="nome${k}"></td>
          <td><input inputmode="decimal" data-c="desvio" data-i="${k}" value="${valor(p.desvios[k])}" ${k === 0 ? 'disabled' : ''} aria-label="Desvio do grau ${g} em cents"></td>
          <td data-s="hz${k}"></td><td>${dedilhado(k, true)}</td></tr>`).join('');
        return `
          <h2>Tom do pífano</h2>
          <p class="ajuda">A tônica é a nota que soa com os seis furos tampados.</p>
          <div class="grade2">
            <label class="campo"><span>Nota</span><select data-c="nota">${notas}</select></label>
            <label class="campo"><span>Oitava</span><select data-c="oitava">${oitavas}</select></label>
          </div>
          <div class="cartao"><p class="grande" data-s="tonica"></p><p class="ajuda" data-s="tonicaInfo"></p></div>
          <label class="campo"><span>Diapasão Lá4 (Hz)</span><input inputmode="decimal" data-c="la4" value="${valor(p.la4)}"></label>
          <p class="ajuda">Toque um pouco antes de afinar: o sopro aquece o ar dentro do pífano e a nota sobe.</p>
          <h3>Afinação da escala</h3>
          <label class="campo"><span>Modelo</span><select data-c="afinacao">${modelos}</select></label>
          <p class="ajuda">Desvio de cada grau em cents (100 = 1 semitom) em relação à escala maior temperada. Os modelos são aproximações: ajuste pelo pífano de referência.</p>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>Grau</th><th>Nota</th><th>Desvio</th><th>Hz</th><th>Dedilhado</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table></div>`;
      },
      saidas(p, pl) {
        const s = {
          tonica: `${nomeGrau(pl, 0)} · ${hz(pl.alvos[0])}`,
          tonicaInfo: `Meia onda: ${mm(pl.meiaOnda)}.`,
        };
        pl.alvos.forEach((f, k) => { s['nome' + k] = nomeGrau(pl, k); s['hz' + k] = fmt(f, 1); });
        return s;
      },
    },

    bambu: {
      html(p) {
        return `
          <h2>Escolha do bambu</h2>
          <div class="cartao">
            <p>Diâmetro interno recomendado</p><p class="grande" data-s="faixa"></p>
            <p>Comprimento mínimo do gomo (por dentro)</p><p class="grande" data-s="gomo"></p>
            <p class="ajuda" data-s="gomoInfo"></p>
          </div>
          <p class="ajuda">O topo fica fechado pelo nó (ou por uma rolha) e o pé fica aberto. Meça o gomo a partir da face interna do nó.</p>
          <h3>Bambu escolhido</h3>
          <div class="grade2">
            <label class="campo"><span>Diâm. interno no topo (mm)</span><input inputmode="decimal" data-c="dTopo" value="${valor(p.dTopo)}"></label>
            <label class="campo"><span>Diâm. interno no pé (mm)</span><input inputmode="decimal" data-c="dPe" value="${valor(p.dPe)}" placeholder="igual ao topo"></label>
          </div>
          <label class="campo"><span>Espessura da parede (mm)</span><input inputmode="decimal" data-c="parede" value="${valor(p.parede)}" placeholder="3"></label>
          <div data-s="avisoBambu"></div>
          <p class="ajuda">Meça o diâmetro interno nas duas pontas (paquímetro, orelhas internas). O cálculo considera o bambu afinando de forma linear entre elas.</p>`;
      },
      saidas(p, pl) {
        const L = pl.geo.comprimento;
        let aviso = '';
        if (p.dTopo != null) {
          const razao = pl.meiaOnda / p.dTopo;
          if (p.dTopo < pl.faixa[0]) aviso = `<p class="aviso">Bambu estreito para este tom (comprimento/diâmetro ≈ ${fmt(razao)}): graves mais fracos, agudos fáceis. Os furos ficarão pequenos.</p>`;
          else if (p.dTopo > pl.faixa[1]) aviso = `<p class="aviso">Bambu largo para este tom (comprimento/diâmetro ≈ ${fmt(razao)}): graves fortes, segunda oitava mais difícil e baixa. Os furos ficarão grandes.</p>`;
          else aviso = `<p class="ok">Dentro da faixa (comprimento/diâmetro ≈ ${fmt(razao)}).</p>`;
        }
        return {
          faixa: `${fmt(pl.faixa[0])} a ${fmt(pl.faixa[1])} mm`,
          gomo: pl.falhou ? '—' : mm(pl.gomo),
          gomoInfo: pl.falhou ? '' : `${mm(pl.geo.rolha)} do nó até a embocadura + ${mm(L)} até o pé + ${mm(pl.margem)} de margem para afinar. `
            + (p.dTopo ? `Calculado com ${mm(pl.dTopo, 1)}.` : `Calculado com ${mm(pl.dTopo, 1)}, o meio da faixa.`),
          avisoBambu: aviso,
        };
      },
    },

    emb: {
      html(p) {
        const trava = p.embFeito ? 'disabled' : '';
        return `
          <h2>Embocadura</h2>
          <div class="cartao">
            <p>Centro da embocadura a</p><p class="grande" data-s="rolhaSug"></p>
            <p>da face interna do nó (ou da rolha).</p>
          </div>
          <div class="cartao">
            <p>Diâmetro final sugerido</p><p class="grande" data-s="embSug"></p>
            <p data-s="embIni"></p>
          </div>
          <details class="mais"><summary>Dicas</summary>
            <ul>
              <li>Comece menor e alargue aos poucos. Furo pequeno dá som doce e fácil, mas fraco; furo maior dá mais volume e pede mais ar.</li>
              <li>Mantenha o furo redondo e a borda de sopro limpa e firme.</li>
              <li>Risque agora uma linha reta ao longo do bambu passando pela embocadura: os furos dos dedos ficam sobre ela.</li>
            </ul>
          </details>
          <h3>Como ficou</h3>
          <div class="grade2">
            <label class="campo"><span>Distância do nó (mm)</span><input inputmode="decimal" data-c="rolha" value="${valor(p.rolha)}" ${trava}></label>
            <label class="campo"><span>Diâmetro final (mm)</span><input inputmode="decimal" data-c="embDiam" value="${valor(p.embDiam)}" ${trava}></label>
          </div>
          ${p.embFeito
            ? `<p class="ok">Embocadura registrada.</p><button type="button" class="secundario largo" data-acao="embRefazer">Alterar embocadura</button>`
            : `<button type="button" class="largo" data-acao="embFeita">Embocadura feita</button>`}
          ${p.embFeito && p.compFeito ? '<p class="aviso">O comprimento já foi calibrado com esta embocadura. Se mudar a embocadura, confirme o comprimento de novo.</p>' : ''}`;
      },
      saidas(p, pl) {
        const ini = Math.max(4, arred05(pl.sug.emb - 1.5));
        return {
          rolhaSug: mm(pl.sug.rolha),
          embSug: mm(pl.sug.emb, 1),
          embIni: `Comece com ${mm(ini, 1)} e alargue até o som ficar cheio.`,
          'ph:rolha': String(pl.sug.rolha),
          'ph:embDiam': valor(pl.sug.emb),
        };
      },
    },

    comp: {
      html(p) {
        const trava = p.compFeito ? 'disabled' : '';
        return `
          <h2>Comprimento</h2>
          ${p.embFeito ? '' : '<p class="aviso">Faça a embocadura antes: o tamanho dela muda o comprimento.</p>'}
          <div class="cartao">
            <p>Comprimento previsto (centro da embocadura → pé)</p><p class="grande" data-s="L"></p>
            <p data-s="corte"></p>
          </div>
          <div class="cartao alvo">
            <p>Com o tubo ainda sem furos, afine em</p><p class="grande" data-s="alvoComp"></p>
            <p class="ajuda" data-s="alvoCompInfo"></p>
          </div>
          <p class="ajuda">Sopre com a força normal de tocar. Se estiver baixo, encurte o pé 1 a 2 mm por vez (ou lixe). Pare um pouco antes do alvo: encurtar não tem volta.</p>
          <h3>Como ficou</h3>
          <label class="campo"><span>Comprimento final, do centro da embocadura ao pé (mm)</span>
            <input inputmode="decimal" data-c="comprimento" value="${valor(p.comprimento)}" ${trava}></label>
          ${p.compFeito
            ? `<p class="ok" data-s="calib"></p><button type="button" class="secundario largo" data-acao="compRefazer">Alterar comprimento</button>`
            : `<button type="button" class="largo" data-acao="compConfirmar">Confirmar comprimento</button>`}`;
      },
      saidas(p, pl) {
        const alvo = p.compFeito ? p.alvoComp : pl.alvoComp;
        const desvio = A.cents(alvo, pl.alvos[0]);
        return {
          L: pl.falhou ? '—' : mm(pl.geo.comprimento),
          corte: p.compFeito ? '' : `Primeiro corte em <b>${mm(pl.geo.comprimento + pl.margem)}</b> (margem de segurança).`,
          alvoComp: `${nomeGrau(pl, 0)} ${sinal(desvio)}¢ · ${hz(alvo)}`,
          alvoCompInfo: `Fica ${fmt(Math.abs(desvio))} cents ${desvio >= 0 ? 'acima' : 'abaixo'} da tônica porque os furos, mesmo tampados, ${desvio >= 0 ? 'abaixam' : 'sobem'} um pouco a nota.`,
          calib: `Comprimento ${mm(p.comprimento, 1)}. Correção da embocadura calibrada: ${sinal(p.deltaEmb, 1)} mm.`,
        };
      },
    },

    furo: {
      html(p, s) {
        const i = s.i, h = p.furos[i];
        const trava = h.feito ? 'disabled' : '';
        let bloqueio = '';
        if (!p.compFeito) bloqueio = '<p class="aviso">Confirme o comprimento antes de furar.</p>';
        else if (i > 0 && !p.furos[i - 1].feito) bloqueio = `<p class="aviso">Faça e confirme o furo ${i} antes: este cálculo usa as medidas reais dele.</p>`;
        return `
          <h2>Furo ${i + 1} · <span data-s="nota"></span></h2>
          <p class="ajuda">Contando a partir do pé. Abrindo este furo e os de baixo, soa o ${A.GRAUS[i + 1]} grau.</p>
          ${dedilhado(i + 1)}
          ${bloqueio}
          <div class="cartao">
            <p>Centro do furo a</p><p class="grande" data-s="pos"></p>
            <p data-s="posInfo"></p>
          </div>
          <div class="cartao">
            <p>Diâmetro final previsto</p><p class="grande" data-s="diam"></p>
            <p data-s="broca"></p>
            ${h.feito ? '' : `<label class="campo"><span>Usar outro diâmetro (mm)</span><input inputmode="decimal" data-c="furo.diamPlan" data-i="${i}" value="${valor(h.diamPlan)}" placeholder="automático"></label>`}
          </div>
          <div data-s="avisos"></div>
          <div class="cartao alvo">
            <p>Afine em</p><p class="grande" data-s="alvo"></p>
            <p class="ajuda" data-s="alvoInfo"></p>
          </div>
          <details class="mais"><summary>Como afinar o furo</summary>
            <ul>
              <li>Fure com broca (ou ferro quente) menor que o previsto, no ponto marcado sobre a linha.</li>
              <li>Alargue aos poucos e confira no afinador: furo maior → nota mais aguda.</li>
              <li>Chegou ao diâmetro previsto e ainda está baixo? Alargue puxando para o lado da embocadura.</li>
              <li>Passou do ponto? Um pouco de cera na borda do lado da embocadura baixa a nota.</li>
            </ul>
          </details>
          <h3>Como ficou</h3>
          <div class="grade2">
            <label class="campo"><span>Posição real (mm da emb.)</span><input inputmode="decimal" data-c="furo.posReal" data-i="${i}" value="${valor(h.feito ? h.pos : h.posReal)}" ${trava}></label>
            <label class="campo"><span>Diâmetro final (mm)</span><input inputmode="decimal" data-c="furo.diamReal" data-i="${i}" value="${valor(h.feito ? h.diam : h.diamReal)}" ${trava}></label>
          </div>
          <label class="toggle">
            <span>Corrigir os próximos furos pelo resultado deste</span>
            <input type="checkbox" data-c="corrigir" ${p.corrigir ? 'checked' : ''}>
            <span class="toggle-track"></span></label>
          ${h.feito
            ? `<p class="ok" data-s="feitoInfo"></p><button type="button" class="secundario largo" data-acao="furoRefazer">Alterar furo ${i + 1}</button>`
            : `<button type="button" class="largo" data-acao="furoConfirmar">Confirmar furo ${i + 1}</button>`}`;
      },
      saidas(p, pl, s) {
        const i = s.i, h = p.furos[i], inf = pl.info[i], g = pl.geo;
        const pos = g.furos[i].pos, diam = g.furos[i].diam;
        const partes = [`ou ${mm(g.comprimento - pos)} do pé`];
        if (i > 0) partes.push(`${mm(g.furos[i - 1].pos - pos)} acima do furo ${i}`);

        const avisos = [];
        if (inf.fora === 'alto') avisos.push(h.diamPlan
          ? 'Com esse diâmetro a nota não é alcançada: aumente o diâmetro.'
          : `Mesmo com ${mm(diam, 1)} a nota não é alcançada: o bambu pode ser estreito demais para esta escala.`);
        if (inf.fora === 'baixo') avisos.push(`O furo ficaria encostado no furo ${i || 'do pé'}: diminua o diâmetro.`);
        if (i > 0 && !inf.fora) {
          const vao = g.furos[i - 1].pos - pos;
          const folga = vao - (diam + g.furos[i - 1].diam) / 2;
          if (folga < 3) avisos.push(`Sobra só ${mm(folga, 1)} de bambu entre este furo e o furo ${i}. Diminua o diâmetro deste furo.`);
          else if (i !== 3 && vao > VAO_MAX_DEDOS) avisos.push(`${mm(vao)} até o furo ${i} pode ser longe para os dedos. Para aproximar, aumente o diâmetro deste furo ou diminua o do furo ${i}.`);
        }

        const alvo = h.feito ? h.alvo : inf.alvoAfinador;
        const desvio = A.cents(alvo, pl.alvos[i + 1]);
        let alvoInfo = i < 5
          ? `${sinal(desvio)} cents em relação à nota final: os furos de cima ainda não existem e, quando feitos, mudam um pouco esta nota.`
          : 'Este é o último furo: afine direto na nota final.';
        if (!h.feito && inf.erro) alvoInfo += ` A posição já inclui a correção de ${sinal(inf.erro)} cents medida no passo anterior.`;
        const broca = Math.max(3, arred05(diam - 2));
        return {
          nota: nomeGrau(pl, i + 1),
          pos: mm(pos, h.feito ? 1 : 0),
          posInfo: partes.join(' · '),
          diam: mm(diam, 1),
          broca: h.feito ? '' : `Comece com ${mm(broca, 1)}.`,
          avisos: avisos.map((a) => `<p class="aviso">${a}</p>`).join(''),
          alvo: `${nomeGrau(pl, i + 1)} ${sinal(desvio)}¢ · ${hz(alvo)}`,
          alvoInfo,
          feitoInfo: `Furo a ${mm(h.pos, 1)} com ${mm(h.diam, 1)}. Diferença do modelo: ${sinal(h.erro)} cents.`,
          'ph:furo.posReal': fmt(pos, 1),
          'ph:furo.diamReal': fmt(diam, 1),
        };
      },
    },

    resumo: {
      html() {
        return `
          <h2>Resumo</h2>
          <h3>Notas previstas</h3>
          <div class="tabela-rolagem" data-s="tabNotas"></div>
          <p class="ajuda">Previsão do modelo com as medidas registradas (furos ainda não feitos entram pelo plano). “2ª oit.” é o desvio da oitava de cima em relação ao dobro da nota de baixo.</p>
          <h3>Medidas</h3>
          <div class="tabela-rolagem" data-s="tabMedidas"></div>
          <button type="button" class="secundario largo" data-acao="exportar">Exportar arquivo deste pífano</button>`;
      },
      saidas(p, pl) {
        if (pl.falhou) return { tabNotas: '—', tabMedidas: '—' };
        const prev = previsoes(pl);
        const cor = (c) => (Math.abs(c) <= 5 ? 'c-ok' : Math.abs(c) <= 15 ? 'c-perto' : 'c-longe');
        const notas = prev.map((r, k) => {
          const d1 = A.cents(r.f1, r.alvo), d2 = A.cents(r.f2, 2 * r.f1);
          return `<tr><td>${A.GRAUS[k]} ${nomeGrau(pl, k)}</td><td>${fmt(r.alvo, 1)}</td><td>${fmt(r.f1, 1)}</td>
            <td class="${cor(d1)}">${sinal(d1)}</td><td class="${cor(d2)}">${isFinite(d2) ? sinal(d2) : '—'}</td></tr>`;
        }).join('');
        const g = pl.geo;
        const linhas = [
          `<tr><td>Embocadura</td><td>0</td><td>${fmt(g.comprimento)}</td><td>${fmt(g.embDiam, 1)}</td><td>${p.embFeito ? '✓' : 'plano'}</td></tr>`,
          ...[5, 4, 3, 2, 1, 0].map((i) => `<tr><td>Furo ${i + 1}</td><td>${fmt(g.furos[i].pos, 1)}</td><td>${fmt(g.comprimento - g.furos[i].pos, 1)}</td>
            <td>${fmt(g.furos[i].diam, 1)}</td><td>${p.furos[i].feito ? '✓' : 'plano'}</td></tr>`),
          `<tr><td>Pé</td><td>${fmt(g.comprimento, 1)}</td><td>0</td><td>${fmt(g.dPe, 1)}</td><td>${p.compFeito ? '✓' : 'plano'}</td></tr>`,
        ].join('');
        return {
          tabNotas: `<table><thead><tr><th>Nota</th><th>Alvo Hz</th><th>Prev. Hz</th><th>¢</th><th>2ª oit. ¢</th></tr></thead><tbody>${notas}</tbody></table>`,
          tabMedidas: `<table><thead><tr><th></th><th>da emb.</th><th>do pé</th><th>diâm.</th><th></th></tr></thead><tbody>${linhas}</tbody></table>
            <p class="ajuda">Medidas em mm. Rolha/nó a ${mm(g.rolha)} acima da embocadura; parede ${mm(g.parede, 1)}; diâmetro interno ${fmt(g.dTopo, 1)} → ${fmt(g.dPe, 1)} mm.</p>`,
        };
      },
    },
  };

  // ---------- desenho do tubo ----------
  function renderTubo(pl) {
    const el = $('#tubo');
    if (pl.falhou) {
      el.innerHTML = '<p class="aviso erro">Não foi possível calcular com essas medidas. Confira o tom e o diâmetro do bambu.</p>';
      return;
    }
    const p = proj(), s = PASSOS[p.passo], g = pl.geo;
    const no = 5, pad = 4;
    const x0 = pad + no + g.rolha; // centro da embocadura
    const L = g.comprimento;
    const W = x0 + L + pad;
    const E = 2; // espessura e furos ampliados para caber na tela do celular
    const dMax = (Math.max(g.dTopo, g.dPe) + 2 * g.parede) * E;
    const yc = 18 + dMax / 2;
    const H = yc + dMax / 2 + 6;
    const ext = (d) => (d / 2 + g.parede) * E;
    const yTopo = (x) => yc - ext(A.diametroEm(g, x));
    const yBase = (x) => yc + ext(A.diametroEm(g, x));
    let svg = `<svg viewBox="0 0 ${fmt2(W)} ${fmt2(H)}" role="img" aria-label="Desenho do pífano em escala">`;
    svg += `<polygon class="t-corpo" points="${fmt2(x0 - g.rolha - no)},${fmt2(yTopo(0))} ${fmt2(x0 + L)},${fmt2(yTopo(L))} ${fmt2(x0 + L)},${fmt2(yBase(L))} ${fmt2(x0 - g.rolha - no)},${fmt2(yBase(0))}"/>`;
    svg += `<rect class="t-no" x="${fmt2(x0 - g.rolha - no)}" y="${fmt2(yTopo(0))}" width="${no}" height="${fmt2(2 * ext(g.dTopo))}"/>`;
    const atualPe = s.id === 'comp';
    svg += `<line class="${atualPe ? 't-atual-linha' : 't-pe'}" x1="${fmt2(x0 + L)}" y1="${fmt2(yTopo(L) - 2)}" x2="${fmt2(x0 + L)}" y2="${fmt2(yBase(L) + 2)}"/>`;
    const classe = (feito, atual) => (atual ? 't-atual' : feito ? 't-feito' : 't-plano');
    svg += `<circle class="${classe(p.embFeito, s.id === 'emb')}" cx="${fmt2(x0)}" cy="${yc}" r="${fmt2(g.embDiam / 2 * E)}"/>`;
    svg += `<text class="t-rotulo" x="${fmt2(x0)}" y="13">E</text>`;
    g.furos.forEach((f, i) => {
      if (!(f.pos > 0)) return;
      const atual = s.id === 'furo' && s.i === i;
      svg += `<circle class="${classe(p.furos[i].feito, atual)}" cx="${fmt2(x0 + f.pos)}" cy="${yc}" r="${fmt2(f.diam / 2 * E)}"/>`;
      svg += `<text class="t-rotulo${atual ? ' t-rotulo-atual' : ''}" x="${fmt2(x0 + f.pos)}" y="13">${i + 1}</text>`;
    });
    svg += '</svg>';
    el.innerHTML = svg + `<p class="legenda">Comprimento em escala, espessura ampliada 2× · do nó ao pé: ${mm(g.rolha + L)} · furos numerados a partir do pé</p>`;
  }
  const fmt2 = (v) => (Math.round(v * 10) / 10).toString();

  // ---------- montagem da página ----------
  function renderProjetos() {
    $('#projeto').innerHTML = Object.values(banco.projetos)
      .map((q) => `<option value="${q.id}" ${q.id === banco.atual ? 'selected' : ''}>${esc(q.nome)}</option>`).join('');
  }

  function renderNav() {
    const p = proj();
    $('#passos').innerHTML = PASSOS.map((s, k) =>
      `<button type="button" data-passo="${k}" class="${passoFeito(p, k) && k > 0 ? 'feito' : ''}" ${k === p.passo ? 'aria-current="step"' : ''}>${s.rot}</button>`).join('');
    const atual = $('#passos [aria-current]');
    if (atual) atual.scrollIntoView({ block: 'nearest', inline: 'center' });
    $('#anterior').disabled = p.passo === 0;
    $('#proximo').disabled = p.passo === PASSOS.length - 1;
  }

  function renderPasso() {
    const p = proj(), s = PASSOS[p.passo];
    $('#passo').innerHTML = ETAPAS[s.id].html(p, s);
    renderNav();
    atualizar();
  }

  function atualizar() {
    const p = proj(), s = PASSOS[p.passo];
    const pl = plano();
    renderTubo(pl);
    const saidas = pl.falhou && s.id !== 'tom' && s.id !== 'bambu' ? {} : ETAPAS[s.id].saidas(p, pl, s);
    for (const [k, v] of Object.entries(saidas)) {
      if (k.startsWith('ph:')) {
        const campo = $(`[data-c="${k.slice(3)}"]`);
        if (campo) campo.placeholder = v;
      } else {
        $$(`[data-s="${k}"]`).forEach((el) => { el.innerHTML = v; });
      }
    }
    $$('#passos button').forEach((b, k) => b.classList.toggle('feito', k > 0 && passoFeito(p, k)));
    atualizarAlvoAfinador();
  }

  let espera = null;
  function agendar() {
    clearTimeout(espera);
    espera = setTimeout(atualizar, 300);
  }

  function definir(el) {
    const p = proj();
    const c = el.dataset.c;
    const i = el.dataset.i != null ? +el.dataset.i : null;
    if (c === 'corrigir') { p.corrigir = el.checked; salvar(); atualizar(); return; }
    if (el.tagName === 'SELECT') {
      if (c === 'afinacao') {
        p.afinacao = el.value;
        if (A.AFINACOES[el.value]) p.desvios = [...A.AFINACOES[el.value].desvios];
        salvar();
        renderPasso();
        return;
      }
      p[c] = +el.value;
      salvar();
      atualizar();
      return;
    }
    const v = num(el.value);
    if (c === 'desvio') {
      p.desvios[i] = v || 0;
      p.afinacao = 'personalizada';
      const sel = $('[data-c="afinacao"]');
      if (sel) sel.value = 'personalizada';
    } else if (c.startsWith('furo.')) {
      p.furos[i][c.slice(5)] = v;
    } else {
      p[c] = v;
    }
    salvar();
    agendar();
  }

  // ---------- ações ----------
  function irPara(k) {
    const p = proj();
    p.passo = Math.max(0, Math.min(PASSOS.length - 1, k));
    salvar();
    renderPasso();
    window.scrollTo({ top: 0 });
  }

  const ACOES = {
    embFeita() { proj().embFeito = true; salvar(); renderPasso(); },
    embRefazer() { proj().embFeito = false; salvar(); renderPasso(); },

    compConfirmar() {
      const p = proj(), pl = plano();
      if (p.comprimento == null) { alert('Informe o comprimento final medido.'); return; }
      const alvo = pl.alvoComp;
      const geo = { ...pl.geo, comprimento: p.comprimento, furos: [], deltaEmb: 0 };
      const d = A.calibrarEmbocadura(geo, 0, alvo, pl.gas);
      if (d == null) {
        alert('Essa medida está muito longe do previsto pelo cálculo. Confira o comprimento e as medidas da embocadura.');
        return;
      }
      Object.assign(p, { deltaEmb: d, alvoComp: alvo, compFeito: true });
      salvar();
      renderPasso();
    },
    compRefazer() { proj().compFeito = false; salvar(); renderPasso(); },

    furoConfirmar() {
      const p = proj(), pl = plano(), i = PASSOS[p.passo].i, h = p.furos[i];
      if (!p.compFeito) { alert('Confirme o comprimento antes.'); return; }
      const pos = Math.round((h.posReal ?? pl.geo.furos[i].pos) * 10) / 10;
      const diam = Math.round((h.diamReal ?? pl.geo.furos[i].diam) * 10) / 10;
      const alvo = pl.info[i].alvoAfinador;
      const furos = pl.geo.furos.slice(0, i + 1).map((f) => ({ ...f }));
      furos[i] = { pos, diam };
      const fModelo = A.ressonancia({ ...pl.geo, furos }, i + 1, pl.gas, alvo);
      Object.assign(h, { pos, diam, alvo, erro: A.cents(fModelo, alvo), feito: true });
      salvar();
      renderPasso();
    },
    furoRefazer() {
      const p = proj(), h = p.furos[PASSOS[p.passo].i];
      Object.assign(h, { feito: false, posReal: h.pos, diamReal: h.diam });
      salvar();
      renderPasso();
    },

    novo() {
      const nome = prompt('Nome do novo pífano:', 'Pífano ' + (Object.keys(banco.projetos).length + 1));
      if (nome == null) return;
      const q = novoProjeto(nome.trim() || undefined);
      banco.projetos[q.id] = q;
      banco.atual = q.id;
      salvar();
      cache.chave = null;
      renderProjetos();
      renderPasso();
    },
    renomear() {
      const p = proj();
      const nome = prompt('Novo nome:', p.nome);
      if (!nome) return;
      p.nome = nome.trim();
      salvar();
      renderProjetos();
    },
    apagar() {
      const p = proj();
      if (!confirm(`Apagar “${p.nome}”? Não dá para desfazer.`)) return;
      delete banco.projetos[p.id];
      if (!Object.keys(banco.projetos).length) {
        const q = novoProjeto();
        banco.projetos[q.id] = q;
      }
      banco.atual = Object.keys(banco.projetos)[0];
      salvar();
      cache.chave = null;
      renderProjetos();
      renderPasso();
    },
    exportar() {
      const p = proj();
      const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.nome.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    importar() { $('#arquivo').click(); },
  };

  $('#arquivo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dados = JSON.parse(await f.text());
      if (!dados || !Array.isArray(dados.furos)) throw new Error();
      const q = completar(dados);
      q.id = novoProjeto().id;
      banco.projetos[q.id] = q;
      banco.atual = q.id;
      salvar();
      cache.chave = null;
      renderProjetos();
      renderPasso();
    } catch (err) {
      alert('Arquivo inválido.');
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acao]');
    if (b && ACOES[b.dataset.acao]) {
      const menu = b.closest('details');
      if (menu) menu.open = false;
      ACOES[b.dataset.acao]();
      return;
    }
    const passo = e.target.closest('[data-passo]');
    if (passo) irPara(+passo.dataset.passo);
  });
  $('#passo').addEventListener('input', (e) => { if (e.target.dataset.c && e.target.tagName === 'INPUT') definir(e.target); });
  $('#passo').addEventListener('change', (e) => { if (e.target.dataset.c && e.target.tagName === 'SELECT') definir(e.target); });
  $('#anterior').addEventListener('click', () => irPara(proj().passo - 1));
  $('#proximo').addEventListener('click', () => irPara(proj().passo + 1));
  $('#projeto').addEventListener('change', (e) => {
    banco.atual = e.target.value;
    salvar();
    cache.chave = null;
    renderPasso();
  });

  // ---------- afinador ----------
  const af = new window.Afinador(mostrarLeitura);

  function alvoAfinador() {
    const p = proj(), s = PASSOS[p.passo], pl = plano();
    if (pl.falhou) return null;
    if (s.id === 'comp') return { f: p.compFeito ? p.alvoComp : pl.alvoComp, nome: nomeGrau(pl, 0), aberto: 0 };
    if (s.id === 'furo') {
      const h = p.furos[s.i];
      return { f: h.feito ? h.alvo : pl.info[s.i].alvoAfinador, nome: nomeGrau(pl, s.i + 1), aberto: s.i + 1 };
    }
    return null;
  }

  function atualizarAlvoAfinador() {
    if ($('#afinador').hidden) return;
    const a = alvoAfinador();
    $('#afAlvo').innerHTML = a
      ? `Alvo: <b>${a.nome} ${sinal(A.cents(a.f, plano().alvos[a.aberto]))}¢</b> · ${hz(a.f)}`
      : 'Sem alvo nesta etapa: mostrando a nota mais próxima.';
  }

  function mostrarLeitura(r) {
    const agulha = $('#afAgulha'), cents = $('#afCents');
    const a = alvoAfinador();
    if (!r) {
      agulha.style.opacity = '0.2';
      $('#afNota').textContent = '—';
      $('#afHz').innerHTML = '&nbsp;';
      cents.innerHTML = '&nbsp;';
      cents.className = 'af-cents';
      return;
    }
    const la4 = proj().la4 || 440;
    const midi = 69 + 12 * Math.log2(r.f / la4);
    const ref = a ? a.f : la4 * Math.pow(2, (Math.round(midi) - 69) / 12);
    const c = A.cents(r.f, ref);
    $('#afNota').textContent = A.nomeMidi(midi);
    $('#afHz').textContent = hz(r.f);
    agulha.style.opacity = r.estavel ? '1' : '0.5';
    agulha.style.left = `${50 + Math.max(-50, Math.min(50, c))}%`;
    cents.textContent = `${sinal(c)} cents`;
    cents.className = 'af-cents ' + (Math.abs(c) <= 5 ? 'afinado' : Math.abs(c) <= 20 ? 'perto' : 'longe');
  }

  async function abrirAfinador() {
    $('#afinador').hidden = false;
    $('#abrirAfinador').hidden = true;
    atualizarAlvoAfinador();
    $('#afMsg').textContent = 'Sopre a nota com a força normal de tocar.';
    try {
      await af.iniciar();
    } catch (err) {
      $('#afMsg').textContent = err.name === 'NotAllowedError'
        ? 'Sem permissão para usar o microfone. Libere nas configurações do navegador.'
        : err.message || 'Não foi possível abrir o microfone.';
    }
  }

  function fecharAfinador() {
    af.parar();
    af.pararTom();
    $('#afTom').textContent = '▶ Ouvir alvo';
    $('#afinador').hidden = true;
    $('#abrirAfinador').hidden = false;
  }

  $('#abrirAfinador').addEventListener('click', abrirAfinador);
  $('#fecharAfinador').addEventListener('click', fecharAfinador);
  $('#afTom').addEventListener('click', () => {
    if (af.tocando) {
      af.pararTom();
      $('#afTom').textContent = '▶ Ouvir alvo';
    } else {
      const a = alvoAfinador();
      af.tocar(a ? a.f : plano().alvos[0]);
      $('#afTom').textContent = '■ Parar';
    }
  });
  // ---------- início ----------
  renderProjetos();
  renderPasso();
})();
