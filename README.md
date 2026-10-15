# Construtor de Pífanos

Página (HTML + JavaScript, sem servidor) que guia a construção de um pífano de 6 furos:
tom → bambu → embocadura → comprimento → furos 1 a 6 (a partir do pé) → resumo.
Os dados ficam no `localStorage` do aparelho; cada pífano pode ser exportado/importado em JSON.

## Como abrir

O afinador usa o microfone, e o navegador só libera o microfone em `https://` ou `localhost`.

```sh
python3 -m http.server 8000
# abra http://localhost:8000
```

Para usar no celular, publique a pasta num serviço com https (por exemplo, GitHub Pages).

## Arquivos

- `js/acustica.js` — modelo acústico (matriz de transferência; furos por Keefe 1990;
  perdas nas paredes; bambu levemente cônico). Calcula comprimento e posição dos furos.
- `js/afinador.js` — afinador (Web Audio + YIN) e tom de referência.
- `js/app.js` — etapas, armazenamento, desenho do tubo.

## Como o cálculo se corrige durante a construção

1. Ao confirmar o comprimento, a correção da embocadura é calibrada para o modelo bater
   com o tubo real.
2. A cada furo confirmado, a diferença entre o modelo e a nota real (em cents) é aplicada
   ao cálculo dos furos seguintes (pode ser desligada).
3. O alvo do afinador durante a construção já desconta o efeito dos furos de cima, que
   ainda não existem.
