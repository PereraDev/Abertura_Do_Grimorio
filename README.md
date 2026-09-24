# Abertura do Grimório

Protótipo de xadrez 3D no navegador, ambientado num grimório de bruxo (peças vivas, que reagem, destroem e falam). As peças são um **bestiário arcano próprio** — Acólito, Grifo, Oráculo, Gárgula, Arquimaga e Coração — não guerreiros medievais, com IA de verdade (Stockfish), comando de voz e personalidade.

Roda 100% no cliente — sem build step, sem backend próprio. Só HTML/JS + Three.js via import map.

## Como rodar

Qualquer servidor estático local funciona (precisa ser servido via `http://`, não `file://`, por causa dos módulos ES e do Web Worker do Stockfish):

```bash
python -m http.server 8723
```

Depois abra `http://localhost:8723/index.html`.

## Funcionalidades

**O pacto (tela de entrada)**
- Antes do hub, uma tela de "assinar o pacto" (nome de conjurador + palavra-passe) — narrativa, não uma conta real: sem backend, só valida campos preenchidos e guarda o nome localmente. Campos sem fundo/borda fechada (só a pauta de tinta no pergaminho), foco em brilho roxo em vez do outline padrão do navegador, runas decorativas (fonte `Noto Sans Runic`) e assinatura em SVG.

**Tabuleiro e peças**
- Bestiário arcano: **Acólito** (peão), **Grifo** (cavalo), **Oráculo** (bispo), **Gárgula** (torre), **Arquimaga** (rainha) e **Coração** (rei) — 12 modelos esculpidos (par bruxo/branco e golem/preto por tipo), otimizados com `gltf-transform` de ~70MB brutos pra ~2-3MB cada. O nome clássico continua reconhecido no comando de voz e explicado no modal de ajuda, pra não quebrar quem já sabe jogar xadrez.
- Peças se encaram como um exército (brancas viram 180° pra olhar pras pretas) — isso significa que, na câmera padrão, suas próprias peças de trás mostram as costas; é intencional, não bug.
- Porte relativo ajustado por peça (`ESCALA_PECA` + `altura` calibrada por tipo em `PECAS_ESPECIAIS`): Acólitos pequenos, Grifo/Gárgula/Oráculo médios, Arquimaga/Coração mais imponentes.
- Marcações de coordenada (a-h, 1-8) entalhadas em relevo 3D na moldura do tabuleiro (`TextGeometry`), reagindo à luz da cena.
- Tabuleiro com casas em formato de azulejo (leve fresta entre elas, revelando a base escura por baixo como rejunte) e variação de tom/rugosidade por casa. Moldura de pedra ao redor do grid, com uma gema rúnica dourada em cada canto.
- Iluminação de castelo à noite: luar frio direcional + tochas quentes tremeluzentes + ambiente de reflexo (IBL), com tone mapping cinematográfico.

**Hub e códice**
- **Hub inicial**: overlay de configuração (modo de jogo, dificuldade, cor das peças, guia do tabuleiro, tempo de partida, visual do tabuleiro) cobre o tabuleiro antes de qualquer partida. Só quando o jogador aperta **► Iniciar Partida** é que o relógio começa a contar; escolher "Aleatório" na cor dispara o floreio de moeda do cara-ou-coroa. Uma fita de navegação leva pro **Códice** (Historia) e, em breve, pro perfil do jogador.
- **Códice**: vitrine 3D de cada peça — câmera livre (arraste pra girar, olha de qualquer ângulo, sem restrição), com uma lore curta ao lado e um toggle Bruxo/Golem pra ver as duas cores. "Avança" percorre as 6 peças.
- **Guia do tabuleiro opcional**: por padrão, selecionar uma peça pinta as casas-destino (verde livre, vermelho captura); pode ser desligado no hub pra quem quer jogar sem dica visual — a validação de clique continua igual, só a pintura é que some.

**Jogo**
- Lógica e validação via `chess.js` (roque, en passant, promoção, xeque, xeque-mate, empates). Promoção sempre vira Arquimaga (sem escolha de peça), refletida visualmente (`PieceView.promoverPara`).
- Placar de material no HUD (`#placar`): soma os pontos das peças capturadas por cada lado e mostra quem está à frente.
- **Cronômetro por jogador**, três controles de tempo FIDE (Clássico 90+30, Rápido 15+10 — padrão —, Blitz 3+2). O tempo de cada lado fica sempre visível junto ao retrato (não só no relógio central, que mostra em destaque quem tem a vez agora); zerar o relógio encerra a partida na hora. **Pausar** (ícone ao lado do registro de lances) congela o relógio e bloqueia clique, disponível nos dois modos — só quando o tabuleiro já está esperando um clique, não tenta interromper a IA no meio do cálculo.
- Dois modos de jogo: **contra a IA** (padrão, Stockfish 19) ou **dois jogadores locais** (revezam no mesmo dispositivo).
- **Cara ou coroa**: chama um lado antes do giro da moeda rúnica pra decidir quem começa de brancas.
- No modo dois jogadores, a câmera gira 180° sozinha a cada lance, como se girasse fisicamente a mesa.
- IA real: **Stockfish 19** (build `lite-single`, WASM sem threads) num Web Worker, protocolo UCI. Três dificuldades (Aprendiz / Intermediário / Bruxo Mestre).
- Animação sequenciada por Promises: peça anda → rajada de energia rúnica no alvo → peça capturada explode em fragmentos de pedra com física simples → turno passa.
- Painel "Como jogar / Regras": diagramas de movimento gerados com o `chess.js` de verdade, controles e regras especiais, com o glossário arcano explicado.
- Comando de voz (Web Speech API, pt-BR): fala o lance ("grifo para f3", "roque curto"), casado contra a lista de lances legais da posição atual.
- Peças com personalidade: toggle "Este é o seu conjunto?" alterna falas confiantes/desconfiadas, reagindo a capturas.

**Interface e mobile**
- HUD minimalista: status + ícones (voz, ajuda, config, pausa) em vez de painel cheio; registro de lances recolhível. SVG de linha em vez de emoji do sistema.
- Tipografia via Google Fonts: **Cinzel** (títulos/status), **EB Garamond**/**Crimson Text** (corpo), **Noto Sans Runic** (runas decorativas do pacto e do códice).
- Layout responsivo com breakpoint dedicado pra celular em paisagem: HUD e registro de lances encolhem e o registro passa pro lado direito da tela (evita cobrir o placar numa tela curta); safe-area pra notch/gestos.
- Toque no mobile distingue tap (seleciona peça) de arraste (gira câmera ou orbita a peça no códice) por distância e duração do gesto.

## Estrutura de arquivos

```
index.html              HUD, telas do pacto/hub/códice, modais de regras/config (markup puro)
src/style.css            todo o CSS (incl. responsivo)
src/main.js              tudo o resto (cena, orquestrador de turnos, IA, voz, falas, destruição, códice)
models/pecas/{acolito,grifo,oraculo,gargula,arquimaga,coracao}_{branco,preto}.glb   os 12 pares de peças esculpidas, otimizados com gltf-transform
models/pecas/antigo/     conjunto anterior de peças, backup não usado pelo jogo
assets/hub/{moldura,placa,coruja,chapeu,dragao,cristal}.webp   arte do hub (Gemini + Canva), fundo removido e recomprimida
assets/hub/{placar,historico}.webp   arte do HUD e do registro de lances em jogo
assets/hub/emblema-{bruxo,golem}.webp   retrato circular de cada lado (jogador/IA) no placar
assets/hub/pergaminho.webp   textura de página usada no pacto/hub/códice
assets/fonts/               fonte decorativa do título (Wild Breath)
stockfish/                motor Stockfish 19 lite-single (worker + wasm) + licença
DEVLOG.md                histórico completo de desenvolvimento, sessão por sessão (local, não versionado)
```

`main.js` tem ~3000 linhas organizadas em seções comentadas: utilitários → diagramas de movimento → comandos de voz → cena/luzes/tabuleiro/marcações → peças (bestiário procedural + peças especiais) → destruição → ataque rúnico → peças com personalidade → Stockfish → orquestrador de turnos (turnos, placar, relógios, pausa) → pacto → hub → códice → input → voz → loop principal → inicialização.

## Stack técnica

- **Three.js** (r0.160, via unpkg) — cena, câmera, luzes, `GLTFLoader` (peças especiais), `OrbitControls` (tabuleiro e códice), `TextGeometry`.
- **chess.js** (1.0.0-beta.8) — regras e validação.
- **Stockfish 19 lite-single** — motor de IA, WASM em Web Worker.
- **gltf-transform** (`@gltf-transform/cli optimize`) — decima/comprime cada modelo esculpido antes de entrar no jogo (weld + simplify + recompressão de textura).
- **Gemini + Canva** — arte 2D do hub/pacto/códice (molduras, criaturas, placas), processada localmente (chroma-key + recorte + WebP) antes de entrar no jogo.
- Sem bundler, sem framework — import map direto no `index.html`.

## Licenças e créditos

- **Bestiário procedural (fallback, não usado no set atual)**: modelado 100% em código nesse projeto — sem dependência de asset externo, sem restrição de licença.
- **As 12 peças esculpidas** (6 tipos × bruxo/golem): modelos 3D esculpidos externamente e integrados ao jogo, otimizados com `gltf-transform`.
- **Arte do hub/pacto/códice** (moldura, coruja, chapéu, dragão, cristal, placa, pergaminho): gerada via Gemini — sujeita aos termos de uso do Google para conteúdo gerado.
- **Stockfish**: GPLv3. Roda como processo separado (Worker + UCI por texto), sem linkagem com o código do jogo — mesmo modelo usado por sites de xadrez como lichess.org.

## Limitações conhecidas / próximos passos

- Sem promoção com escolha de peça (sempre promove a Arquimaga).
- Reconhecimento de voz depende do navegador suportar `SpeechRecognition`/`webkitSpeechRecognition` (Chrome/Edge sim, Firefox não).
- Regra FIDE de "tempo esgotado com material insuficiente pro adversário dar mate = empate" não é verificada — nesse caso raro, o jogo declara vitória por tempo do mesmo jeito.
- Controle de tempo Clássico é a versão simplificada (90+30 direto), não a regra FIDE completa de duas fases.
- "Meu perfil" (fita de navegação do hub/códice) ainda não tem tela própria — botão existe, desabilitado, é o próximo passo.
- Pacto de entrada não tem conta real: nome/senha só validam preenchimento, sem autenticação nem servidor.
