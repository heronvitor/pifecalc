# Construtor de Pífanos

Página (HTML + JavaScript, sem servidor) que guia a construção de um pífano de 6 furos:
tom → bambu → embocadura → comprimento → furos 1 a 6 (a partir do pé) → resumo.
Os dados ficam no `localStorage` do aparelho; cada pífano pode ser exportado/importado em JSON.

## Como abrir

Abra o `index.html` no navegador. Para usar no celular, publique a pasta (por exemplo, GitHub Pages).
Para afinar, use um afinador cromático qualquer (aplicativo no celular, por exemplo).

## Arquivos

- `js/acustica.js` — modelo acústico (matriz de transferência; furos por Keefe 1990;
  perdas nas paredes; bambu levemente cônico). Calcula comprimento e posição dos furos.
- `js/app.js` — etapas, armazenamento, desenho do tubo.

## Como o cálculo se corrige durante a construção

1. Ao confirmar o comprimento, a correção da embocadura é calibrada para o modelo bater
   com o tubo real.
2. A cada furo confirmado, a diferença entre o modelo e a nota real (em cents) é aplicada
   ao cálculo dos furos seguintes (pode ser desligada).
