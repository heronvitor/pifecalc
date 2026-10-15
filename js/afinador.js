/*
 * Afinador pelo microfone (Web Audio API + algoritmo YIN).
 * Exige contexto seguro: https:// ou localhost.
 */
(function (global) {
  'use strict';

  const F_MIN = 150; // Hz — abaixo de qualquer pífano
  const F_MAX = 3000;
  const LIMIAR = 0.12;

  // Devolve { f, clareza } ou null.
  function yin(buf, taxa) {
    const tauMax = Math.min(Math.floor(taxa / F_MIN), Math.floor(buf.length / 2));
    const tauMin = Math.floor(taxa / F_MAX);
    const W = buf.length - tauMax;
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = buf[j] - buf[j + tau];
        s += v * v;
      }
      d[tau] = s;
    }
    // diferença média normalizada cumulativa
    let soma = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      soma += d[tau];
      d[tau] = soma > 0 ? d[tau] * tau / soma : 1;
    }
    let tau = tauMin;
    while (tau < tauMax && d[tau] >= LIMIAR) tau++;
    if (tau >= tauMax) return null;
    while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
    // interpolação parabólica
    let t = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      if (den !== 0) t = tau + (a - c) / (2 * den);
    }
    return { f: taxa / t, clareza: 1 - d[tau] };
  }

  function mediana(v) {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  class Afinador {
    constructor(aoLer) {
      this.aoLer = aoLer;
      this.ctx = null;
      this.stream = null;
      this.hist = [];
      this.osc = null;
    }

    get ativo() { return !!this.stream; }

    contexto() {
      if (!this.ctx) this.ctx = new (global.AudioContext || global.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    async iniciar() {
      if (this.stream) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Este navegador não dá acesso ao microfone aqui. Abra a página por https:// ou localhost.');
      }
      const ctx = this.contexto();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.fonte = ctx.createMediaStreamSource(this.stream);
      this.analisador = ctx.createAnalyser();
      this.analisador.fftSize = 2048;
      this.fonte.connect(this.analisador);
      this.buf = new Float32Array(this.analisador.fftSize);
      this.hist = [];
      this.quadro = 0;
      const laco = () => {
        if (!this.stream) return;
        this.raf = requestAnimationFrame(laco);
        if (this.quadro++ % 2) return; // ~30 leituras/s bastam
        this.analisador.getFloatTimeDomainData(this.buf);
        let rms = 0;
        for (let i = 0; i < this.buf.length; i++) rms += this.buf[i] * this.buf[i];
        rms = Math.sqrt(rms / this.buf.length);
        const r = rms > 0.01 ? yin(this.buf, ctx.sampleRate) : null;
        if (!r || r.clareza < 0.8) {
          this.hist = [];
          this.aoLer(null);
          return;
        }
        // descarta saltos (troca de nota) reiniciando a média
        if (this.hist.length && Math.abs(1200 * Math.log2(r.f / this.hist[this.hist.length - 1])) > 60) this.hist = [];
        this.hist.push(r.f);
        if (this.hist.length > 7) this.hist.shift();
        this.aoLer({ f: mediana(this.hist), estavel: this.hist.length >= 5, rms });
      };
      laco();
    }

    parar() {
      cancelAnimationFrame(this.raf);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.fonte) this.fonte.disconnect();
      this.hist = [];
    }

    tocar(f) {
      const ctx = this.contexto();
      this.pararTom();
      const ganho = ctx.createGain();
      ganho.gain.setValueAtTime(0, ctx.currentTime);
      ganho.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(ganho).connect(ctx.destination);
      osc.start();
      this.osc = { osc, ganho };
    }

    pararTom() {
      if (!this.osc) return;
      const { osc, ganho } = this.osc;
      const t = this.ctx.currentTime;
      ganho.gain.setValueAtTime(ganho.gain.value, t);
      ganho.gain.linearRampToValueAtTime(0, t + 0.05);
      osc.stop(t + 0.06);
      this.osc = null;
    }

    get tocando() { return !!this.osc; }
  }

  global.Afinador = Afinador;
  global.Afinador.yin = yin;
})(typeof window !== 'undefined' ? window : globalThis);
