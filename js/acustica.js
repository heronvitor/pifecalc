/*
 * Modelo acústico do pífano.
 *
 * O tubo é tratado como uma sequência de cilindros (o bambu pode afinar
 * linearmente do topo ao pé). A frequência que soa é o mínimo de impedância
 * visto pelo jato de ar na embocadura, calculado pelo método da matriz de
 * transferência. Furos laterais seguem as fórmulas de Keefe (1990); perdas
 * visco-térmicas nas paredes seguem Fletcher & Rossing.
 *
 * Todas as medidas geométricas de entrada estão em milímetros; as posições
 * são medidas a partir do CENTRO DA EMBOCADURA em direção ao pé.
 * Furo 1 = o mais próximo do pé; furo 6 = o mais próximo da embocadura.
 */
(function (global) {
  'use strict';

  // ---------- números complexos ([re, im]) ----------
  const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  };
  const cabs = (a) => Math.hypot(a[0], a[1]);
  const cscale = (a, s) => [a[0] * s, a[1] * s];
  const csin = (z) => [Math.sin(z[0]) * Math.cosh(z[1]), Math.cos(z[0]) * Math.sinh(z[1])];
  const ccos = (z) => [Math.cos(z[0]) * Math.cosh(z[1]), -Math.sin(z[0]) * Math.sinh(z[1])];
  const paralelo = (a, b) => cdiv(cmul(a, b), cadd(a, b));

  // ---------- música ----------
  const NOMES = ['Dó', 'Dó♯', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Si♭', 'Si'];
  const GRAUS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const ESCALA_MAIOR = [0, 2, 4, 5, 7, 9, 11];

  // Desvios em cents por grau (I..VII) em relação à escala maior temperada.
  const AFINACOES = {
    temperada: { nome: 'Maior temperada', desvios: [0, 0, 0, 0, 0, 0, 0] },
    mixolidia: { nome: 'Mixolídia (7ª menor)', desvios: [0, 0, 0, 0, 0, 0, -100] },
    neutra: { nome: 'Neutra (3ª e 7ª a ¾ de tom)', desvios: [0, 0, -50, 0, 0, 0, -50] },
    nordestina: { nome: 'Nordestina (4ª aum., 7ª menor)', desvios: [0, 0, 0, 100, 0, 0, -100] },
  };

  function freqMidi(midi, la4) {
    return la4 * Math.pow(2, (midi - 69) / 12);
  }

  function nomeMidi(midi) {
    const m = Math.round(midi);
    return NOMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function cents(f, ref) {
    return 1200 * Math.log2(f / ref);
  }

  // Frequências-alvo das 7 posições (tônica + 6 furos abertos progressivamente).
  function alvos(cfg) {
    const base = cfg.midi;
    return ESCALA_MAIOR.map((st, i) => freqMidi(base + st + cfg.desvios[i] / 100, cfg.la4));
  }

  // ---------- ar ----------
  function ar(temperatura) {
    const T = 273.15 + temperatura;
    return {
      c: 331.3 * Math.sqrt(T / 273.15), // m/s
      rho: 1.2929 * 273.15 / T, // kg/m³
    };
  }

  // ---------- geometria ----------
  // geo = { dTopo, dPe, parede, rolha, embDiam, comprimento, deltaEmb,
  //         furos: [{ pos, diam }] (índice 0 = furo 1, perto do pé) }
  function diametroEm(geo, x) {
    const t = Math.min(Math.max(x / geo.comprimento, 0), 1);
    return geo.dTopo + (geo.dPe - geo.dTopo) * t;
  }

  // Impedância de um furo lateral (série e paralelo), Keefe 1990.
  function furoImpedancias(raioTubo, raioFuro, altura, aberto, kr, rhoc) {
    const a = raioTubo, b = raioFuro, d = b / a;
    const Zh = rhoc / (Math.PI * b * b);
    const Zc = rhoc / (Math.PI * a * a);
    const ti = b * (0.822 - 0.10 * d - 1.57 * d * d + 2.14 * d ** 3 - 1.6 * d ** 4 + 0.5 * d ** 5);
    let Zs, ta;
    if (aberto) {
      const tk = Math.tan(kr * altura);
      const te = (tk / kr + b * (1.40 - 0.58 * d * d)) / (1 - 0.61 * kr * b * tk);
      Zs = cscale([0.25 * (kr * b) ** 2, kr * te], Zh);
      ta = -0.47 * b * d ** 4 / (Math.tanh(1.84 * altura / b) + 0.62 * d * d + 0.64 * d);
    } else {
      // tubinho fechado: -j Zh cot(k t) + j k ti Zh
      Zs = [0, Zh * (-1 / Math.tan(kr * altura) + kr * ti)];
      ta = -0.47 * b * d ** 4 / (1 / Math.tanh(1.84 * altura / b) + 0.62 * d * d + 0.64 * d);
    }
    return { Zs, Za: [0, kr * Zc * ta] };
  }

  /*
   * Impedância vista pelo jato na frequência f.
   * nAbertos: quantos furos (a partir do pé) estão abertos.
   * Furos com índice >= geo.furos.length simplesmente não existem.
   */
  function impedanciaJato(geo, f, nAbertos, gas) {
    const w = 2 * Math.PI * f;
    const kr = w / gas.c;
    const rhoc = gas.rho * gas.c;
    const mm = 1e-3;

    // Pontos de interesse do pé para a embocadura.
    const furos = geo.furos
      .map((h, i) => ({ pos: h.pos, diam: h.diam, aberto: i < nAbertos }))
      .filter((h) => h.pos > 0 && h.pos < geo.comprimento)
      .sort((p, q) => q.pos - p.pos);

    // Radiação na ponta aberta (sem flange).
    const aPe = diametroEm(geo, geo.comprimento) / 2 * mm;
    const ZcPe = rhoc / (Math.PI * aPe * aPe);
    let Z = cscale([0.25 * (kr * aPe) ** 2, kr * 0.6133 * aPe], ZcPe);

    let x = geo.comprimento;
    const propaga = (ate) => {
      const L = x - ate;
      if (L <= 0) return;
      const nSeg = Math.max(1, Math.ceil(L / 10));
      const passo = L / nSeg;
      for (let s = 0; s < nSeg; s++) {
        const meio = x - passo * (s + 0.5);
        const a = diametroEm(geo, meio) / 2 * mm;
        const Zc = rhoc / (Math.PI * a * a);
        const alfa = 3.0e-5 * Math.sqrt(f) / a;
        const kl = [(kr + alfa) * passo * mm, -alfa * passo * mm];
        const s_ = csin(kl), c_ = ccos(kl);
        const num = cadd(cmul(Z, c_), cmul([0, Zc], s_));
        const den = cadd(cscale(c_, Zc), cmul(cmul([0, 1], Z), s_));
        Z = cscale(cdiv(num, den), Zc);
      }
      x = ate;
    };

    for (const h of furos) {
      propaga(h.pos);
      const a = diametroEm(geo, h.pos) / 2 * mm;
      const b = h.diam / 2 * mm;
      const altura = (geo.parede + (h.diam / 2) * (h.diam / diametroEm(geo, h.pos)) / 4) * mm;
      const { Zs, Za } = furoImpedancias(a, b, altura, h.aberto, kr, rhoc);
      const meioZa = cscale(Za, 0.5);
      Z = cadd(paralelo(cadd(Z, meioZa), Zs), meioZa);
    }
    propaga(0);

    // Trecho fechado entre a rolha (ou nó) e o centro da embocadura.
    const aTopo = geo.dTopo / 2 * mm;
    const ZcTopo = rhoc / (Math.PI * aTopo * aTopo);
    const kc = kr * geo.rolha * mm;
    const Zrolha = [0, -ZcTopo / Math.tan(kc)];
    const Zbase = paralelo(Z, Zrolha);

    // Chaminé da embocadura, com correção extra pelo lábio cobrindo parte do furo.
    const be = geo.embDiam / 2 * mm;
    const Ze = rhoc / (Math.PI * be * be);
    const d = be / aTopo;
    const ti = be * (0.822 - 0.10 * d - 1.57 * d * d + 2.14 * d ** 3 - 1.6 * d ** 4 + 0.5 * d ** 5);
    const te = geo.parede * mm + ti + CORRECAO_LABIO * be + (geo.deltaEmb || 0) * mm;
    return cadd(Zbase, cscale([0.25 * (kr * be) ** 2, kr * te], Ze));
  }

  // Fator empírico: correção externa da embocadura em múltiplos do raio do furo.
  // Escolhido para reproduzir a correção de embocadura usada no Flutomat (Benade).
  let CORRECAO_LABIO = 1.5;

  /*
   * Frequência de ressonância (mínimo de |Z| no jato).
   * Varre para cima a partir de uma oitava abaixo de fRef e devolve o
   * 1º mínimo (registro 1) ou o 2º (registro 2). Infinity se não achar.
   */
  function ressonancia(geo, nAbertos, gas, fRef, registro = 1) {
    const z = (f) => cabs(impedanciaJato(geo, f, nAbertos, gas));
    const passo = 25;
    let achado = null, contagem = 0;
    let ant2 = null, ant1 = null;
    for (let c = -1200; c <= 1200 * registro + 1200; c += passo) {
      const v = z(fRef * Math.pow(2, c / 1200));
      if (ant1 && ant2 && ant1.v < ant2.v && ant1.v <= v) {
        if (++contagem === registro) { achado = ant1; break; }
      }
      ant2 = ant1;
      ant1 = { c, v };
    }
    if (!achado) return Infinity;
    // refino por seção áurea em ±1 passo
    let lo = achado.c - passo, hi = achado.c + passo;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
    const fz = (c) => z(fRef * Math.pow(2, c / 1200));
    let v1 = fz(x1), v2 = fz(x2);
    for (let i = 0; i < 30; i++) {
      if (v1 < v2) { hi = x2; x2 = x1; v2 = v1; x1 = hi - g * (hi - lo); v1 = fz(x1); }
      else { lo = x1; x1 = x2; v1 = v2; x2 = lo + g * (hi - lo); v2 = fz(x2); }
    }
    return fRef * Math.pow(2, (lo + hi) / 2 / 1200);
  }

  // Busca por bisseção: encontra x em [lo, hi] tal que freq(x) = alvo,
  // supondo freq decrescente em x.
  function bissecao(freq, alvo, lo, hi) {
    const fLo = freq(lo), fHi = freq(hi);
    if (alvo > fLo) return { x: lo, fora: 'alto' };
    if (alvo < fHi) return { x: hi, fora: 'baixo' };
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (freq(m) > alvo) lo = m; else hi = m;
      if (hi - lo < 0.1) break;
    }
    return { x: (lo + hi) / 2 };
  }

  // Comprimento (centro da embocadura → pé) que dá a tônica com todos os furos fechados.
  function resolverComprimento(geo, alvo, gas) {
    const freq = (L) => ressonancia({ ...geo, comprimento: L }, 0, gas, alvo);
    const meiaOnda = gas.c / (2 * alvo) * 1000;
    const r = bissecao(freq, alvo, meiaOnda * 0.6, meiaOnda * 1.2);
    return r.fora ? null : r.x;
  }

  // Posição do furo i (0 = furo 1) para que, aberto junto com os de baixo, soe o alvo.
  function resolverFuro(geo, i, alvo, gas) {
    const furos = geo.furos.map((h) => ({ ...h }));
    const abaixo = i > 0 ? furos[i - 1] : null;
    const hi = abaixo ? abaixo.pos - (abaixo.diam + furos[i].diam) / 2 - 2 : geo.comprimento - furos[i].diam;
    const lo = geo.rolha + geo.embDiam;
    const freq = (x) => {
      furos[i].pos = x;
      return ressonancia({ ...geo, furos }, i + 1, gas, alvo);
    };
    // Perto da embocadura (nó de pressão) o furo quase não age: a frequência
    // sobe do pé até um pico e depois volta a cair. Só a faixa pico→pé serve.
    let xPico = hi, fPico = -Infinity;
    for (let s = 0; s <= 12; s++) {
      const x = lo + (hi - lo) * s / 12;
      const f = freq(x);
      if (f > fPico) { fPico = f; xPico = x; }
    }
    const r = bissecao(freq, alvo, xPico, hi);
    r.fMax = fPico;
    return r;
  }

  // Diâmetro do furo i, numa posição fixa, para que soe o alvo.
  // Furo maior → nota mais aguda; por isso a bisseção usa a frequência com sinal trocado.
  function resolverDiametro(geo, i, alvo, gas, dMin, dMax) {
    const furos = geo.furos.map((h) => ({ ...h }));
    const freq = (d) => {
      furos[i].diam = d;
      return ressonancia({ ...geo, furos }, i + 1, gas, alvo);
    };
    const r = bissecao((d) => -freq(d), -alvo, dMin, dMax);
    if (r.fora) r.fora = r.fora === 'alto' ? 'pequeno' : 'grande';
    return r;
  }

  // Correção da embocadura (deltaEmb, mm) para o modelo bater com uma medição real.
  function calibrarEmbocadura(geo, nAbertos, fMedida, gas) {
    const freq = (d) => ressonancia({ ...geo, deltaEmb: d }, nAbertos, gas, fMedida);
    const r = bissecao(freq, fMedida, -40, 80);
    return r.fora ? null : r.x;
  }

  global.Acustica = {
    NOMES, GRAUS, ESCALA_MAIOR, AFINACOES,
    freqMidi, nomeMidi, cents, alvos, ar, diametroEm,
    impedanciaJato, ressonancia, resolverComprimento, resolverFuro, resolverDiametro, calibrarEmbocadura,
    _setCorrecaoLabio(v) { CORRECAO_LABIO = v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
