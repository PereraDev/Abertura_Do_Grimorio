# Abertura do Grimório

Protótipo de xadrez 3D no navegador, inspirado no clima do xadrez de bruxo (peças vivas, que reagem, destroem e falam). As peças são **criaturas de pedra rúnica** — um bestiário próprio, não guerreiros medievais — com IA de verdade (Stockfish), comando de voz e peças com personalidade.

Roda 100% no cliente — sem build step, sem backend próprio. Só HTML/JS + Three.js via import map.

## Como rodar

Qualquer servidor estático local funciona (precisa ser servido via `http://`, não `file://`, por causa dos módulos ES e do Web Worker do Stockfish):

```bash
python -m http.server 8723
```

Depois abra `http://localhost:8723/index.html`.

## Funcionalidades

**Tabuleiro e peças**
- Bestiário de pedra rúnica. Todos os 6 tipos de peça usam modelos esculpidos reais, gerados por texto-pra-3D no Meshy.ai (um par branco/preto cada) — o conjunto 100% procedural (`CONSTRUTOR_CRIATURA`) que existia antes continua no código, mas só entra se algum tipo não tiver modelo especial cadastrado em `PECAS_ESPECIAIS`. Cada modelo especial já vem com pedestal esculpido próprio, então a base octogonal procedural é pulada nesse caso, pra não duplicar.
- Peças se encaram como um exército (brancas viram 180° pra olhar pras pretas) — isso significa que, na câmera padrão, suas próprias peças de trás (rei, bispo, cavalo) mostram as costas; é intencional, não bug (confirmado com o usuário depois de cogitar uma exceção só pro rei e descartar).
- Porte relativo ajustado por peça (`ESCALA_PECA` + `altura` calibrada por tipo em `PECAS_ESPECIAIS`, medida a partir da geometria procedural equivalente): peão pequeno, cavalo/torre médios, bispo/dama/rei mais imponentes.
- Marcações de coordenada (a-h, 1-8) entalhadas em relevo 3D na moldura do tabuleiro (`TextGeometry`), reagindo à luz da cena.
- Tabuleiro com casas em formato de azulejo (leve fresta entre elas, revelando a base escura por baixo como rejunte) e variação de tom/rugosidade por casa — mesma técnica usada nas peças, pra não ficar um grid plano de textura única. Moldura de pedra ao redor do grid, com uma gema rúnica dourada em cada canto ecoando o motivo dos pedestais das peças.
- Iluminação de castelo à noite: luar frio direcional + tochas quentes tremeluzentes + ambiente de reflexo (IBL), com tone mapping cinematográfico.

**Jogo**
- **Hub inicial**: a partida não começa sozinha ao carregar a página — um overlay de configuração cobre o tabuleiro logo de cara (modo de jogo, dificuldade, cor das peças, tempo de partida, visual do tabuleiro), com os campos de decisão rápida como botões de alternância (contorno dourado no ativo, sem verde/cores saturadas) em vez de dropdowns. Só quando o jogador aperta **► Iniciar Partida** é que o relógio começa a contar e a IA pode abrir a partida sozinha; escolher "Aleatório" na cor dispara o mesmo floreio de moeda girando do cara-ou-coroa antes de começar. O botão fica desabilitado ("Carregando...") até os modelos 3D terminarem de carregar.
- Lógica e validação via `chess.js` (roque, en passant, promoção, xeque, xeque-mate, empates). Promoção sempre vira dama (sem escolha de peça) e é refletida visualmente: o peão encolhe, troca de modelo 3D pro da dama e cresce de novo (`PieceView.promoverPara`).
- Placar de material no HUD (`#placar`): soma os pontos das peças capturadas por cada lado (peão 1, cavalo/bispo 3, torre 5, dama 9) e mostra quem está à frente; fica oculto enquanto ninguém capturou nada.
- **Cronômetro por jogador**, com três controles de tempo oficiais (FIDE) escolhidos no hub inicial (ou depois, no menu de configurações): Clássico (90min + 30s/lance), Rápido (15min + 10s/lance) ou Blitz (3min + 2s/lance) — padrão Rápido. Cada relógio só corre na vez daquele lado, e só depois de "Jogar" (inclusive durante o "pensar" da IA — o tempo dela também conta), ganha o incremento assim que o lance é concluído, e fica em destaque/negrito enquanto ativo; abaixo de 20s pisca em vermelho. Zerar o relógio encerra a partida na hora ("Tempo esgotado!"), mesmo em posição vencedora — a única simplificação em relação à regra FIDE completa é não ter a segunda fase do controle Clássico (40 lances em 90min + mais 30min); aqui é 90+30 direto do lance 1, como a maioria dos sites de xadrez implementa.
- Casas alcançáveis pela peça selecionada se preenchem de cor sólida — verde pra lance livre, vermelho pra captura — em vez da marcação flutuante de antes; mais fácil de ver à distância/de qualquer ângulo de câmera.
- Dois modos de jogo, escolhidos no menu de configurações: **contra a IA** (padrão) ou **dois jogadores locais** (revezam no mesmo dispositivo, sem Stockfish envolvido — o campo de dificuldade some nesse modo).
- **Cara ou coroa**: o jogador chama um lado (☀️ Cara ou 🌙 Coroa) antes do giro — uma moeda rúnica (dourada de um lado, gelo do outro) sobe, gira no ar acima do tabuleiro e pousa numa face. Quem acerta a chamada vence e começa com as brancas; quem erra fica com as pretas. No modo IA a chamada é sempre sua (perder = a IA joga de brancas e abre a partida sozinha); no modo local a chamada decide qual jogador é "Jogador 1". Ao chamar, o modal de configurações fecha na hora (pra ver a moeda girar no tabuleiro) e o resultado aparece em destaque no centro da tela por 5s, sem bloquear cliques — a partida já começa em paralelo.
- No modo dois jogadores, a câmera **gira 180° sozinha** a cada lance — assim que um lado joga, o tabuleiro vira pro lado de quem joga a seguir, como se girasse fisicamente a mesa (preserva o zoom/ângulo que cada jogador tiver ajustado). Cliques ficam bloqueados durante o giro; no modo IA a câmera não gira.
- IA real: **Stockfish 19** (build `lite-single`, WASM sem threads) rodando num Web Worker, comunicação por protocolo UCI. Três níveis de dificuldade no menu de configurações (Iniciante / Intermediário / Bruxo Mestre — Skill Level + depth/movetime).
- Animação sequenciada por Promises: peça anda → rajada de energia rúnica no alvo (anel que se expande + cacos, na cor do atacante) → peça capturada explode em fragmentos de pedra com física simples (gravidade + quicada) → turno passa.
- Painel "Como jogar / Regras": diagramas de movimento por peça gerados com o `chess.js` de verdade (garantindo que o que é ensinado bate com o que é validado), controles e regras especiais.
- Comando de voz (Web Speech API, pt-BR): fala o lance ("cavalo para f3", "roque curto"), casado contra a lista de lances legais da posição atual — não é parser de gramática livre.
- Peças com personalidade: toggle "Este é o seu conjunto?" no menu de configurações alterna entre falas confiantes (é seu conjunto) e desconfiadas/sarcásticas (emprestado), reagindo a capturas suas e da IA, com cooldown pra não virar ruído.

**Interface e mobile**
- HUD minimalista: uma linha de status (turno + situação) e um grupo de ícones (voz, ajuda, configurações) no lugar do painel cheio; registro de jogadas (log) recolhível. Ícones em SVG de linha (estilo Feather, `currentColor`) em vez de emoji do sistema — renderização consistente entre plataformas e acompanha a cor do tema/estado (ex.: microfone fica vermelho e pulsa durante escuta).
- Tipografia dupla via Google Fonts: **Cinzel** (inspirada em inscrições romanas, efeito de "letras entalhadas") no status do HUD e nos títulos dos modais; **EB Garamond** no corpo do texto. Bordas dos painéis (HUD, log, modais, botões de ícone) em gradiente metálico dourado (truque CSS `padding-box`/`border-box`) em vez de linha sólida única, mantendo os cantos arredondados.
- Layout responsivo: câmera e FOV se adaptam a paisagem/retrato (`aplicarModoCamera`), safe-area para notch/gestos (`env(safe-area-inset-*)`, `viewport-fit=cover`).
- Toque no mobile distingue tap (seleciona peça) de arraste (gira câmera) por distância e duração do gesto, evitando seleção acidental ao orbitar o tabuleiro.

## Estrutura de arquivos

```
index.html              HUD, modais de regras/config (markup puro)
src/style.css            todo o CSS (incl. responsivo)
src/main.js              tudo o resto (cena, orquestrador de turnos, IA, voz, falas, destruição)
models/pecas/{peao,cavalo,bispo,torre,dama,rei}_{branco,preto}.glb   os 12 pares de peças esculpidas (Meshy.ai), otimizados com gltf-transform
assets/hub/{moldura,placa,coruja,chapeu,dragao,cristal}.webp   arte do hub inicial (Gemini + Canva), fundo removido e recomprimida
assets/hub/{placar,historico}.webp   arte do HUD e do registro de lances em jogo (Gemini), mesmo pipeline
assets/hub/emblema-{bruxo,golem}.webp   retrato circular de cada lado (jogador/IA) no placar
stockfish/                motor Stockfish 19 lite-single (worker + wasm) + licença
```

`main.js` tem ~2650 linhas organizadas em seções comentadas: utilitários → diagramas de movimento → comandos de voz → cena/luzes/tabuleiro/marcações → peças (bestiário procedural + peças especiais) → destruição → ataque rúnico → peças com personalidade → Stockfish → orquestrador de turnos (turnos, placar, relógios) → input → voz → loop principal → inicialização.

## Stack técnica

- **Three.js** (r0.160, via unpkg) — cena, câmera, luzes, `GLTFLoader` (peças especiais), `TextGeometry`.
- **chess.js** (1.0.0-beta.8) — regras e validação.
- **Stockfish 19 lite-single** — motor de IA, WASM em Web Worker.
- **Meshy.ai** — geração texto-pra-3D dos modelos das 6 peças (par branco/preto cada, 12 arquivos); **gltf-transform** (`@gltf-transform/cli optimize`) decima/comprime cada export bruto do Meshy (8-22 MB) pra ~0.4-1.6 MB antes de entrar no jogo (weld + simplify + texturas WebP 512px).
- **Gemini + Canva** — arte 2D do hub inicial (moldura, criaturas, placa do título), gerada a partir de prompts escritos aqui, exportada do Canva como SVG (na prática, PNG embrulhado) e processada localmente (chroma-key por limiar + recorte + WebP) antes de entrar no jogo.
- Sem bundler, sem framework — import map direto no `index.html`.

## Licenças e créditos

- **Bestiário procedural (fallback, não usado no set atual)**: modelado 100% em código nesse projeto — sem dependência de asset externo, sem restrição de licença.
- **As 6 peças esculpidas**: geradas via Meshy.ai (texto-pra-3D) — sujeitas aos termos de uso da Meshy para o conteúdo gerado.
- **Arte do hub inicial** (moldura, coruja, chapéu, dragão, cristal, placa): gerada via Gemini — sujeita aos termos de uso do Google para conteúdo gerado.
- **Stockfish**: GPLv3. Roda como processo separado (Worker + UCI por texto), sem linkagem com o código do jogo — mesmo modelo usado por sites de xadrez como lichess.org.

## Limitações conhecidas / próximos passos

- Sem promoção com escolha de peça (sempre promove a dama).
- Reconhecimento de voz depende do navegador suportar `SpeechRecognition`/`webkitSpeechRecognition` (Chrome/Edge sim, Firefox não).
- Regra FIDE de "tempo esgotado com material insuficiente pro adversário dar mate = empate" não é verificada — nesse caso raro, o jogo declara vitória por tempo do mesmo jeito.
- Controle de tempo Clássico é a versão simplificada (90+30 direto), não a regra FIDE completa de duas fases (40 lances em 90min + mais 30min).
