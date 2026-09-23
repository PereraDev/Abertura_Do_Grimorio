import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Chess } from "chess.js";

/* ============================================================
   Utilitários
   ============================================================ */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutQuad = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Libera geometria/material de um grupo que não é mais usado, evitando vazar
 *  buffers de GPU. Meshes com `userData.compartilhado` (modelos GLTF
 *  reutilizados entre peças) são pulados. */
function descartarGrupo(grupo) {
  const materiaisDescartados = new Set();
  grupo.traverse((obj) => {
    if (!obj.isMesh || obj.userData.compartilhado) return;
    obj.geometry?.dispose();
    if (obj.material && !materiaisDescartados.has(obj.material)) {
      materiaisDescartados.add(obj.material);
      obj.material.dispose();
    }
  });
}

function squareToPos(square) {
  const file = square.charCodeAt(0) - 97; // a-h -> 0-7
  const rank = parseInt(square[1], 10) - 1; // 1-8 -> 0-7
  return new THREE.Vector3(file - 3.5, 0, 3.5 - rank);
}

function squareFromPoint(x, z) {
  const file = Math.floor(x + 4);
  const rank = Math.floor(-z + 4);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return String.fromCharCode(97 + file) + (rank + 1);
}

function logMsg(texto) {
  const log = document.getElementById("log");
  const linha = document.createElement("div");
  linha.textContent = texto;
  log.prepend(linha);
  while (log.children.length > 8) log.removeChild(log.lastChild);
}

/* ============================================================
   Diagramas de movimento — gerados com chess.js real, não desenhados
   à mão, pra garantir que o tutorial bate com a regra validada.
   ============================================================ */
function construirFEN(pecas, turno) {
  const linhas = [];
  for (let rank = 8; rank >= 1; rank--) {
    let linha = "";
    let vazio = 0;
    for (let f = 0; f < 8; f++) {
      const square = String.fromCharCode(97 + f) + rank;
      const peca = pecas.find((p) => p.square === square);
      if (peca) {
        if (vazio) {
          linha += vazio;
          vazio = 0;
        }
        linha += peca.color === "w" ? peca.type.toUpperCase() : peca.type;
      } else {
        vazio++;
      }
    }
    if (vazio) linha += vazio;
    linhas.push(linha);
  }
  return `${linhas.join("/")} ${turno} - - 0 1`;
}

const REIS_DIAGRAMA = { w: "h1", b: "a8" }; // fora do alcance de qualquer peça em d4

function casasAlcancaveis(tipo) {
  let origem, pecas;
  if (tipo === "p") {
    origem = "e2";
    pecas = [
      { square: origem, type: "p", color: "w" },
      { square: "d3", type: "p", color: "b" }, // ilustra captura na diagonal
      { square: "f3", type: "p", color: "b" },
      { square: REIS_DIAGRAMA.w, type: "k", color: "w" },
      { square: REIS_DIAGRAMA.b, type: "k", color: "b" },
    ];
  } else if (tipo === "k") {
    // a própria peça já é o rei branco — só falta o rei preto, em canto seguro
    origem = "d4";
    pecas = [
      { square: origem, type: "k", color: "w" },
      { square: REIS_DIAGRAMA.b, type: "k", color: "b" },
    ];
  } else {
    origem = "d4";
    pecas = [
      { square: origem, type: tipo, color: "w" },
      { square: REIS_DIAGRAMA.w, type: "k", color: "w" },
      { square: REIS_DIAGRAMA.b, type: "k", color: "b" },
    ];
  }
  const chess = new Chess(construirFEN(pecas, "w"));
  const lances = chess.moves({ square: origem, verbose: true });
  return {
    origem,
    destinos: new Set(lances.filter((l) => !l.captured).map((l) => l.to)),
    capturas: new Set(lances.filter((l) => l.captured).map((l) => l.to)),
  };
}

const NOME_PECA_DIAGRAMA = {
  p: "Acólito",
  n: "Grifo",
  b: "Oráculo",
  r: "Gárgula",
  q: "Arquimaga",
  k: "Coração",
};

/** Troca a letra de peça do SAN (N/B/R/Q/K) pelo nome arcano no registro de
 *  lances — peão fica sem prefixo (como no SAN original) e o roque não
 *  referencia peça por letra, então passa direto. */
function descreverLance(lance) {
  if (lance.san.startsWith("O-O")) return lance.san;
  const nomePeca = NOME_PECA_DIAGRAMA[lance.piece];
  const sufixo = /[+#]$/.exec(lance.san)?.[0] ?? "";
  const captura = lance.captured ? "×" : "";
  const origemPeao = lance.piece === "p" && lance.captured ? lance.from[0] : "";
  let texto =
    lance.piece === "p"
      ? `${origemPeao}${captura}${lance.to}`
      : `${nomePeca} ${captura}${lance.to}`;
  if (lance.promotion) texto += `=${NOME_PECA_DIAGRAMA[lance.promotion]}`;
  return texto + sufixo;
}

function renderizarDiagrama(tipo) {
  const { origem, destinos, capturas } = casasAlcancaveis(tipo);

  const container = document.createElement("div");
  container.className = "diagrama";

  const titulo = document.createElement("div");
  titulo.className = "diagrama-titulo";
  titulo.textContent = NOME_PECA_DIAGRAMA[tipo];
  container.appendChild(titulo);

  const tabuleiro = document.createElement("div");
  tabuleiro.className = "mini-tabuleiro";
  for (let rank = 8; rank >= 1; rank--) {
    for (let f = 0; f < 8; f++) {
      const square = String.fromCharCode(97 + f) + rank;
      const casa = document.createElement("div");
      const clara = (f + rank) % 2 === 1;
      casa.className = `mini-casa ${clara ? "clara" : "escura"}`;
      if (square === origem) {
        const peca = document.createElement("div");
        peca.className = "peca";
        casa.appendChild(peca);
      } else if (destinos.has(square)) {
        const marcador = document.createElement("div");
        marcador.className = "marcador";
        casa.appendChild(marcador);
      } else if (capturas.has(square)) {
        const marcador = document.createElement("div");
        marcador.className = "marcador captura";
        casa.appendChild(marcador);
      }
      tabuleiro.appendChild(casa);
    }
  }
  container.appendChild(tabuleiro);

  const legenda = document.createElement("div");
  legenda.className = "diagrama-legenda";
  legenda.textContent =
    tipo === "p" ? "dourado = andar · vermelho = capturar" : "dourado = anda";
  container.appendChild(legenda);

  return container;
}

function montarDiagramasDeMovimento() {
  const grade = document.getElementById("grade-diagramas");
  for (const tipo of ["p", "n", "b", "r", "q", "k"]) {
    grade.appendChild(renderizarDiagrama(tipo));
  }
}
montarDiagramasDeMovimento();

/* ============================================================
   Comandos de voz — casa o texto reconhecido contra os lances legais
   da posição atual (chess.js), em vez de parsear gramática livre.
   ============================================================ */
// aceita tanto o nome clássico da peça quanto o nome arcano novo (Acólito,
// Grifo, Oráculo, Gárgula, Arquimaga, Coração) — voz por voz é mais
// confiável aceitar as duas formas do que forçar só uma
const NOME_PECA_PARA_TIPO = {
  peao: "p",
  acolito: "p",
  torre: "r",
  gargula: "r",
  cavalo: "n",
  grifo: "n",
  bispo: "b",
  oraculo: "b",
  dama: "q",
  rainha: "q",
  arquimaga: "q",
  rei: "k",
  coracao: "k",
};

function normalizarTexto(texto) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/** Devolve um lance (objeto verbose do chess.js) se achar exatamente um
 *  candidato, ou { naoEntendido } / { ambiguo, candidatos } caso contrário. */
function interpretarComandoDeVoz(chess, textoOriginal) {
  const texto = normalizarTexto(textoOriginal);
  const lancesLegais = chess.moves({ verbose: true });

  if (texto.includes("roque")) {
    const curto = /pequen|curt/.test(texto);
    const longo = /grand|long/.test(texto);
    const candidatos = lancesLegais.filter((l) => {
      if (curto) return l.flags.includes("k");
      if (longo) return l.flags.includes("q");
      return l.flags.includes("k") || l.flags.includes("q");
    });
    if (candidatos.length === 1) return candidatos[0];
    return {
      ambiguo: candidatos.length > 1,
      naoEntendido: candidatos.length === 0,
      candidatos,
    };
  }

  // se a pessoa citar duas casas ("torre de a1 para d1"), a última é o
  // destino e a primeira vira uma dica pra desempatar candidatos
  const squareMatches = [...texto.matchAll(/\b([a-h])\s*-?\s*([1-8])\b/g)].map(
    (m) => m[1] + m[2],
  );
  const squareDestino =
    squareMatches.length > 0 ? squareMatches[squareMatches.length - 1] : null;
  const squareOrigemDica = squareMatches.length > 1 ? squareMatches[0] : null;

  let tipoPeca = null;
  for (const [nome, tipo] of Object.entries(NOME_PECA_PARA_TIPO)) {
    if (texto.includes(nome)) {
      tipoPeca = tipo;
      break;
    }
  }

  if (!squareDestino) {
    if (!tipoPeca) return { naoEntendido: true };
    const porTipo = lancesLegais.filter((l) => l.piece === tipoPeca);
    if (porTipo.length === 1) return porTipo[0];
    return {
      ambiguo: porTipo.length > 1,
      naoEntendido: porTipo.length === 0,
      candidatos: porTipo,
    };
  }

  let candidatos = lancesLegais.filter((l) => l.to === squareDestino);
  if (tipoPeca) candidatos = candidatos.filter((l) => l.piece === tipoPeca);
  if (candidatos.length > 1 && squareOrigemDica) {
    const filtradoPorOrigem = candidatos.filter(
      (l) => l.from === squareOrigemDica,
    );
    if (filtradoPorOrigem.length > 0) candidatos = filtradoPorOrigem;
  }

  if (candidatos.length === 1) return candidatos[0];
  return {
    ambiguo: candidatos.length > 1,
    naoEntendido: candidatos.length === 0,
    candidatos,
  };
}

// mesmo padrão de abrir/fechar pros dois popovers (ajuda e configurações)
function ligarModal(idOverlay, idBotaoAbrir, idBotaoFechar) {
  const overlay = document.getElementById(idOverlay);
  const abrir = () => {
    overlay.hidden = false;
  };
  const fechar = () => {
    overlay.hidden = true;
  };
  document.getElementById(idBotaoAbrir).addEventListener("click", abrir);
  document.getElementById(idBotaoFechar).addEventListener("click", fechar);
  overlay.addEventListener("click", (evento) => {
    if (evento.target === overlay) fechar();
  });
  window.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !overlay.hidden) fechar();
  });
  return { overlay, abrir, fechar };
}

ligarModal("modal-ajuda", "botao-ajuda", "fechar-ajuda");
const modalConfig = ligarModal("modal-config", "botao-config", "fechar-config");

const logMoldura = document.getElementById("log-moldura");
document.getElementById("log-toggle").addEventListener("click", () => {
  logMoldura.classList.toggle("recolhido");
});

/* ============================================================
   Cena Three.js
   ============================================================ */
function criarCeuGradiente() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#040509");
  grad.addColorStop(0.45, "#120e22");
  grad.addColorStop(1, "#2a1d3a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}

const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = criarCeuGradiente();
scene.fog = new THREE.FogExp2(0x140f24, 0.032);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// IBL — sem isso os materiais metálicos ficam quase pretos fora do brilho direto
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  new RoomEnvironment(),
  0.04,
).texture;
pmremGenerator.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.3, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.25;
controls.maxPolarAngle = Math.PI / 2.15;
controls.update();

// em retrato (celular) o FOV horizontal encolhe mais que o vertical e sobra
// vão morto; aproxima a câmera e abre o FOV pra compensar. Só reaplica a
// posição quando o modo muda, não a cada resize, pra não brigar com o zoom manual.
let modoCameraAtual = null;
function aplicarModoCamera() {
  const retrato = window.innerWidth / window.innerHeight < 0.9;
  const modo = retrato ? "retrato" : "paisagem";

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = retrato ? 50 : 38;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (modo === modoCameraAtual) return;
  modoCameraAtual = modo;
  if (retrato) {
    controls.minDistance = 4;
    controls.maxDistance = 11;
    camera.position.set(0, 8.2, 7.2);
  } else {
    controls.minDistance = 5;
    controls.maxDistance = 15;
    camera.position.set(0, 6.6, 9.4);
  }
  controls.update();
}
aplicarModoCamera();

window.addEventListener("resize", aplicarModoCamera);

// giro de câmera 180° — usado no modo dois jogadores pra virar o tabuleiro
// pro lado de quem joga a seguir. Roda em torno do alvo dos controles,
// preservando o zoom/ângulo do jogador; avançado a partir do loop principal.
let giroCamera = null;
let cameraViradaParaPreto = false; // usado só pra re-alinhar num reinício, ver reiniciar()
function iniciarGiroCamera180() {
  controls.autoRotate = false;
  controls.enabled = false;
  cameraViradaParaPreto = !cameraViradaParaPreto;
  const alvo = controls.target;
  return new Promise((resolve) => {
    giroCamera = {
      relX0: camera.position.x - alvo.x,
      relZ0: camera.position.z - alvo.z,
      t0: performance.now(),
      duracao: 900,
      resolve,
    };
  });
}
function avancarGiroCamera(agora) {
  if (!giroCamera) return;
  const { relX0, relZ0, t0, duracao, resolve } = giroCamera;
  const t = Math.min(1, (agora - t0) / duracao);
  const angulo = Math.PI * easeInOutQuad(t);
  const cos = Math.cos(angulo);
  const sin = Math.sin(angulo);
  const alvo = controls.target;
  camera.position.x = alvo.x + (relX0 * cos - relZ0 * sin);
  camera.position.z = alvo.z + (relX0 * sin + relZ0 * cos);
  if (t >= 1) {
    controls.enabled = true;
    giroCamera = null;
    resolve();
  }
}

// mergulho de câmera ao sair do hub — começa mais alta/recuada e desce até
// a posição de jogo já calculada por aplicarModoCamera, avançado a partir
// do loop principal (mesmo esquema do giro de 180°)
let mergulhoCamera = null;
function iniciarMergulhoCamera() {
  controls.autoRotate = false;
  controls.enabled = false;
  const destino = camera.position.clone();
  const origem = destino.clone().add(new THREE.Vector3(0, 3.2, 2.6));
  camera.position.copy(origem);
  mergulhoCamera = { origem, destino, t0: performance.now(), duracao: 650 };
}
function avancarMergulhoCamera(agora) {
  if (!mergulhoCamera) return;
  const { origem, destino, t0, duracao } = mergulhoCamera;
  const t = Math.min(1, (agora - t0) / duracao);
  camera.position.lerpVectors(origem, destino, easeInOutQuad(t));
  if (t >= 1) {
    mergulhoCamera = null;
    controls.enabled = true;
    controls.autoRotate = true;
  }
}

// luzes — clima de castelo à noite: luar frio + tochas quentes tremeluzentes
scene.add(new THREE.HemisphereLight(0x8a96d4, 0x2a2030, 1.05));

const luzLua = new THREE.DirectionalLight(0xc3ccff, 2.1);
luzLua.position.set(-7, 11, 5);
luzLua.castShadow = true;
luzLua.shadow.mapSize.set(2048, 2048);
luzLua.shadow.camera.left = -6;
luzLua.shadow.camera.right = 6;
luzLua.shadow.camera.top = 6;
luzLua.shadow.camera.bottom = -6;
luzLua.shadow.camera.near = 1;
luzLua.shadow.camera.far = 25;
luzLua.shadow.bias = -0.0015;
scene.add(luzLua, luzLua.target);

const tochas = [
  new THREE.PointLight(0xffaa5c, 2.4, 16, 1.8),
  new THREE.PointLight(0xffaa5c, 2.1, 16, 1.8),
];
tochas[0].position.set(4.7, 2.6, 4.7);
tochas[1].position.set(-4.7, 2.6, -4.7);
const intensidadeBaseTocha = tochas.map((l) => l.intensity);
for (const tocha of tochas) scene.add(tocha);

const tabuleiroGrupo = new THREE.Group();
scene.add(tabuleiroGrupo);

// todas as peças (inclusive em animação) vivem aqui, pra reiniciar() conseguir
// limpar mesmo objetos órfãos deixados por um reinício no meio de um lance
const pecasGrupo = new THREE.Group();
scene.add(pecasGrupo);
const matClara = new THREE.MeshStandardMaterial({
  color: 0xcabb8e,
  roughness: 0.85,
});
const matEscura = new THREE.MeshStandardMaterial({
  color: 0x3a3226,
  roughness: 0.9,
});
const matSelecionada = new THREE.MeshStandardMaterial({
  color: 0x6fae52,
  roughness: 0.7,
  emissive: 0x1c3a12,
});
const matDestino = new THREE.MeshStandardMaterial({
  color: 0x5fbf3f,
  roughness: 0.6,
  emissive: 0x2a5c18,
});
const matCaptura = new THREE.MeshStandardMaterial({
  color: 0xd4453a,
  roughness: 0.6,
  emissive: 0x5c1610,
});

// casas levemente menores que 1×1: a fresta entre elas revela a base escura
// por baixo, como rejunte — lê como azulejos encaixados, não um grid liso
const casaGeo = new THREE.BoxGeometry(0.92, 0.2, 0.92);
const casas = new Map(); // square -> mesh
for (let f = 0; f < 8; f++) {
  for (let r = 0; r < 8; r++) {
    const square = String.fromCharCode(97 + f) + (r + 1);
    const clara = (f + r) % 2 === 1;
    // cada casa clona o material base com leve desvio de tom/rugosidade
    // (mesma função usada nas peças), pra não parecer um grid perfeito demais
    const matCasa = variarMaterial(clara ? matClara : matEscura, 0.04, 0.1);
    const mesh = new THREE.Mesh(casaGeo, matCasa);
    const pos = squareToPos(square);
    mesh.position.set(pos.x, -0.1, pos.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.square = square;
    mesh.userData.materialOriginal = matCasa;
    tabuleiroGrupo.add(mesh);
    casas.set(square, mesh);
  }
}
// base de pedra sob o tabuleiro
const base = new THREE.Mesh(
  new THREE.BoxGeometry(9.2, 0.4, 9.2),
  new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 1 }),
);
base.position.y = -0.5;
base.receiveShadow = true;
scene.add(base);

// moldura de pedra ao redor do grid, com gemas rúnicas nos 4 cantos
// ecoando o motivo dos pedestais das peças
const MATERIAL_MOLDURA = new THREE.MeshStandardMaterial({
  color: 0x352f27,
  roughness: 0.8,
  metalness: 0.12,
});
const ALTURA_MOLDURA = 0.26;
function criarBarraMoldura(largura, profundidade, x, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(largura, ALTURA_MOLDURA, profundidade),
    MATERIAL_MOLDURA,
  );
  mesh.position.set(x, -0.3 + ALTURA_MOLDURA / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  tabuleiroGrupo.add(mesh);
}
criarBarraMoldura(9.2, 0.6, 0, 4.3);
criarBarraMoldura(9.2, 0.6, 0, -4.3);
criarBarraMoldura(0.6, 8.0, 4.3, 0);
criarBarraMoldura(0.6, 8.0, -4.3, 0);

const MATERIAL_GEMA_CANTO = new THREE.MeshStandardMaterial({
  color: 0xd9a544,
  emissive: 0xb5791a,
  emissiveIntensity: 0.9,
  roughness: 0.35,
  metalness: 0.4,
});
for (const [sx, sz] of [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]) {
  const gema = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13),
    MATERIAL_GEMA_CANTO,
  );
  gema.position.set(sx * 4.3, -0.02, sz * 4.3);
  gema.castShadow = true;
  tabuleiroGrupo.add(gema);
}

// visual do tabuleiro (hub inicial): paletas alternativas pra casas/moldura/gemas
const ESTILOS_TABULEIRO = {
  runica: {
    clara: 0xcabb8e,
    escura: 0x3a3226,
    moldura: 0x352f27,
    gema: 0xd9a544,
    gemaEmissiva: 0xb5791a,
  },
  marmore: {
    clara: 0xe6e0d0,
    escura: 0x2c2b33,
    moldura: 0x211f26,
    gema: 0xd9c37a,
    gemaEmissiva: 0x8a6a2a,
  },
  obsidiana: {
    clara: 0x463a58,
    escura: 0x0d0b13,
    moldura: 0x120f1a,
    gema: 0xaa6fe0,
    gemaEmissiva: 0x6a2fa0,
  },
};

/** Troca a paleta do tabuleiro (casas + moldura + gemas), com pré-visualização instantânea no hub. */
function aplicarEstiloTabuleiro(chave) {
  const p = ESTILOS_TABULEIRO[chave] ?? ESTILOS_TABULEIRO.runica;
  matClara.color.setHex(p.clara);
  matEscura.color.setHex(p.escura);
  MATERIAL_MOLDURA.color.setHex(p.moldura);
  MATERIAL_GEMA_CANTO.color.setHex(p.gema);
  MATERIAL_GEMA_CANTO.emissive.setHex(p.gemaEmissiva);
  // cada casa tem seu próprio clone (variarMaterial), então regenera as 64
  for (const [square, mesh] of casas) {
    const arquivo = square.charCodeAt(0) - 97;
    const fileira = Number(square[1]) - 1;
    const clara = (arquivo + fileira) % 2 === 1;
    const novoMaterial = variarMaterial(
      clara ? matClara : matEscura,
      0.04,
      0.1,
    );
    mesh.material = novoMaterial;
    mesh.userData.materialOriginal = novoMaterial;
  }
}

// marcações de coordenada (a-h, 1-8) entalhadas em relevo na moldura,
// em vez de um decalque plano — reagem à luz de verdade
const MATERIAL_ENTALHE = new THREE.MeshStandardMaterial({
  color: 0xc9a24a,
  roughness: 0.4,
  metalness: 0.55,
});

async function criarMarcacoesTabuleiro() {
  const loader = new FontLoader();
  const fonte = await loader.loadAsync(
    "https://unpkg.com/three@0.160.0/examples/fonts/gentilis_bold.typeface.json",
  );

  function criarMarcacao(texto) {
    const geo = new TextGeometry(texto, {
      font: fonte,
      size: 0.26,
      height: 0.035,
      curveSegments: 6,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, 0);
    const mesh = new THREE.Mesh(geo, MATERIAL_ENTALHE);
    mesh.rotation.x = -Math.PI / 2; // relevo raso deitado na moldura, virado pra cima
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const marcacoesGrupo = new THREE.Group();
  scene.add(marcacoesGrupo);
  for (let f = 0; f < 8; f++) {
    const letra = criarMarcacao(String.fromCharCode(97 + f));
    letra.position.set(f - 3.5, 0.001, 4.15);
    marcacoesGrupo.add(letra);
  }
  for (let r = 0; r < 8; r++) {
    const numero = criarMarcacao(String(r + 1));
    numero.position.set(-4.15, 0.001, 3.5 - r);
    marcacoesGrupo.add(numero);
  }
}

/* ============================================================
   Peças — bestiário procedural (fallback quando não há modelo GLTF
   especial pro tipo/cor): peão = entulho, cavalo = lobo, bispo =
   obelisco, torre = tartaruga-fortaleza, dama = serpente-cristal,
   rei = golem coroado. Rocha fosca + veios de runa emissivos
   (dourado nas brancas, gelo nas pretas).
   ============================================================ */
const CORES = {
  w: new THREE.MeshStandardMaterial({
    color: 0xa89478,
    roughness: 0.85,
    metalness: 0.08,
    flatShading: true,
  }), // granito claro
  b: new THREE.MeshStandardMaterial({
    color: 0x2b2a30,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  }), // basalto escuro
};
const CORES_RUNA = {
  w: new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff8c1a,
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.1,
  }),
  b: new THREE.MeshStandardMaterial({
    color: 0x6fd0ff,
    emissive: 0x2a8fd6,
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.1,
  }),
};

// cada peça clona o material base com leve desvio de tom/rugosidade,
// pra não parecerem saídas do mesmo molde
function variarMaterial(
  matBase,
  variacaoLuminosidade = 0.06,
  variacaoRugosidade = 0.08,
) {
  const mat = matBase.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  mat.color.getHSL(hsl);
  hsl.l = THREE.MathUtils.clamp(
    hsl.l + (Math.random() - 0.5) * variacaoLuminosidade,
    0.08,
    0.85,
  );
  mat.color.setHSL(hsl.h, hsl.s, hsl.l);
  mat.roughness = THREE.MathUtils.clamp(
    mat.roughness + (Math.random() - 0.5) * variacaoRugosidade,
    0.15,
    0.95,
  );
  return mat;
}

function criarPedestal(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.36, 0.1, 8),
    matRocha,
  );
  base.position.y = 0.05;
  grupo.add(base);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const runa = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), matRuna);
    runa.position.set(Math.cos(ang) * 0.3, 0.07, Math.sin(ang) * 0.3);
    grupo.add(runa);
  }
  return grupo; // altura total = ALTURA_PEDESTAL
}
const ALTURA_PEDESTAL = 0.1;

function criarOlhos(matRuna, largura, altura, z) {
  const grupo = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.026, 6, 6);
  const esq = new THREE.Mesh(geo, matRuna);
  esq.position.set(-largura / 2, altura, z);
  const dir = new THREE.Mesh(geo, matRuna);
  dir.position.set(largura / 2, altura, z);
  grupo.add(esq, dir);
  return grupo;
}

// peão — entulho: uma pedra pequena e desajeitada que ainda assim se move
function criarPeao(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const corpo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.15, 0),
    matRocha,
  );
  corpo.scale.set(1, 0.8, 1);
  corpo.position.y = ALTURA_PEDESTAL + 0.12;
  grupo.add(corpo);
  const cabeca = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09, 0),
    matRocha,
  );
  cabeca.position.y = ALTURA_PEDESTAL + 0.26;
  grupo.add(cabeca);
  grupo.add(criarOlhos(matRuna, 0.07, ALTURA_PEDESTAL + 0.26, 0.075));
  return grupo;
}

// cavalo — lobo de pedra, flagrado no salto
function criarCavalo(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const y0 = ALTURA_PEDESTAL;

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.34),
    matRocha,
  );
  torso.position.set(0, y0 + 0.22, 0);
  torso.rotation.x = -0.15;
  grupo.add(torso);

  const pescoco = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.18, 0.14),
    matRocha,
  );
  pescoco.position.set(0, y0 + 0.32, 0.19);
  pescoco.rotation.x = 0.5;
  grupo.add(pescoco);

  const focinho = new THREE.Mesh(
    new THREE.ConeGeometry(0.065, 0.22, 4),
    matRocha,
  );
  focinho.rotation.x = Math.PI / 2 + 0.25;
  focinho.rotation.y = Math.PI / 4;
  focinho.position.set(0, y0 + 0.4, 0.31);
  grupo.add(focinho);

  for (const sinal of [-1, 1]) {
    const orelha = new THREE.Mesh(
      new THREE.ConeGeometry(0.032, 0.09, 4),
      matRocha,
    );
    orelha.position.set(sinal * 0.055, y0 + 0.47, 0.22);
    orelha.rotation.x = -0.2;
    grupo.add(orelha);
  }

  grupo.add(criarOlhos(matRuna, 0.06, y0 + 0.4, 0.38));

  const pernaGeo = new THREE.CylinderGeometry(0.026, 0.033, 0.22, 6);
  const dianteiraEsq = new THREE.Mesh(pernaGeo, matRocha);
  dianteiraEsq.position.set(-0.08, y0 + 0.2, 0.15);
  dianteiraEsq.rotation.x = 0.9;
  grupo.add(dianteiraEsq);
  const dianteiraDir = dianteiraEsq.clone();
  dianteiraDir.position.x = 0.08;
  grupo.add(dianteiraDir);

  const traseiraEsq = new THREE.Mesh(pernaGeo, matRocha);
  traseiraEsq.position.set(-0.08, y0 + 0.1, -0.12);
  grupo.add(traseiraEsq);
  const traseiraDir = traseiraEsq.clone();
  traseiraDir.position.x = 0.08;
  grupo.add(traseiraDir);

  const cauda = new THREE.Mesh(
    new THREE.ConeGeometry(0.038, 0.26, 5),
    matRocha,
  );
  cauda.position.set(0, y0 + 0.24, -0.22);
  cauda.rotation.x = Math.PI / 2 + 0.4;
  grupo.add(cauda);

  return grupo;
}

// bispo — obelisco rúnico flutuando um dedo acima do próprio pedestal
function criarBispo(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const y0 = ALTURA_PEDESTAL;

  const corpo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.13, 0.5, 4),
    matRocha,
  );
  corpo.position.y = y0 + 0.32;
  corpo.rotation.y = Math.PI / 4;
  grupo.add(corpo);

  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const runa = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.025, 0),
      matRuna,
    );
    runa.position.set(Math.cos(ang) * 0.16, y0 + 0.08, Math.sin(ang) * 0.16);
    grupo.add(runa);
  }

  const fenda = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.28, 0.02),
    matRuna,
  );
  fenda.position.y = y0 + 0.32;
  grupo.add(fenda);

  const topo = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), matRuna);
  topo.position.y = y0 + 0.62;
  grupo.add(topo);

  return grupo;
}

// torre — tartaruga-fortaleza, casco com ameias
function criarTorre(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const y0 = ALTURA_PEDESTAL;

  const casco = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    matRocha,
  );
  casco.position.y = y0 + 0.16;
  grupo.add(casco);

  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const ameia = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.06, 0.05),
      matRocha,
    );
    ameia.position.set(Math.cos(ang) * 0.17, y0 + 0.28, Math.sin(ang) * 0.17);
    grupo.add(ameia);
  }

  const cabeca = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.09, 0.12),
    matRocha,
  );
  cabeca.position.set(0, y0 + 0.1, 0.22);
  grupo.add(cabeca);
  grupo.add(criarOlhos(matRuna, 0.06, y0 + 0.12, 0.27));

  const pataGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6);
  for (const [x, z] of [
    [-0.14, -0.14],
    [0.14, -0.14],
    [-0.14, 0.12],
    [0.14, 0.12],
  ]) {
    const pata = new THREE.Mesh(pataGeo, matRocha);
    pata.position.set(x, y0 + 0.02, z);
    grupo.add(pata);
  }
  return grupo;
}

// dama — serpente-cristal, corpo em segmentos alternando rocha e runa
function criarDama(matRocha, matRuna) {
  const grupo = new THREE.Group();
  let y = ALTURA_PEDESTAL + 0.1;
  for (let i = 0; i < 6; i++) {
    const raio = 0.13 - i * 0.014;
    const seg = new THREE.Mesh(
      new THREE.OctahedronGeometry(raio, 0),
      i % 2 === 0 ? matRocha : matRuna,
    );
    seg.position.set(Math.sin(i * 0.9) * 0.05, y, 0);
    grupo.add(seg);
    y += 0.11;
  }
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const cristal = new THREE.Mesh(
      new THREE.ConeGeometry(0.024, 0.14, 4),
      matRuna,
    );
    cristal.position.set(Math.cos(ang) * 0.07, y, Math.sin(ang) * 0.07);
    cristal.rotation.x = Math.cos(ang) * 0.3;
    cristal.rotation.z = -Math.sin(ang) * 0.3;
    grupo.add(cristal);
  }
  grupo.add(criarOlhos(matRuna, 0.05, y - 0.16, 0.1));
  return grupo;
}

// rei — golem rúnico coroado, o maior e mais rachado de todos
function criarRei(matRocha, matRuna) {
  const grupo = new THREE.Group();
  const y0 = ALTURA_PEDESTAL;

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.4, 0.22),
    matRocha,
  );
  torso.position.y = y0 + 0.2;
  grupo.add(torso);

  const ombros = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.1, 0.26),
    matRocha,
  );
  ombros.position.y = y0 + 0.38;
  grupo.add(ombros);

  const cabeca = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.15),
    matRocha,
  );
  cabeca.position.y = y0 + 0.5;
  grupo.add(cabeca);
  grupo.add(criarOlhos(matRuna, 0.08, y0 + 0.51, 0.08));

  const fenda = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.25, 0.02),
    matRuna,
  );
  fenda.position.set(0, y0 + 0.2, 0.115);
  grupo.add(fenda);

  const pernaGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.14, 6);
  const pernaEsq = new THREE.Mesh(pernaGeo, matRocha);
  pernaEsq.position.set(-0.08, y0 + 0.07, 0);
  grupo.add(pernaEsq);
  const pernaDir = pernaEsq.clone();
  pernaDir.position.x = 0.08;
  grupo.add(pernaDir);

  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const caco = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.045, 0),
      matRuna,
    );
    caco.position.set(Math.cos(ang) * 0.14, y0 + 0.68, Math.sin(ang) * 0.14);
    caco.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    grupo.add(caco);
  }
  return grupo;
}

const CONSTRUTOR_CRIATURA = {
  p: criarPeao,
  n: criarCavalo,
  b: criarBispo,
  r: criarTorre,
  q: criarDama,
  k: criarRei,
};
// porte relativo — peão pequeno, rei/dama imponentes. Grifo e Gárgula
// igualados ao Oráculo (usuário achou os dois pequenos demais perto do bispo)
const ESCALA_PECA = { p: 0.85, n: 1.05, b: 1.05, r: 1.05, q: 1.05, k: 1.15 };
// valor clássico de cada peça, pro placar de material (rei não entra na conta)
const PONTOS_PECA = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// peças especiais: modelos GLTF, um par branco/preto por tipo, substituem
// a criatura procedural equivalente. `altura` é calibrada pra manter o
// porte relativo entre as peças (todo modelo novo já chega normalizado
// numa altura bruta ~1, então esses valores são o alvo final de verdade).
const PECAS_ESPECIAIS = {
  p: {
    arquivo: { w: "acolito_branco", b: "acolito_preto" },
    altura: 0.35,
    rotacaoExtra: { w: 0, b: 0 },
  },
  n: {
    arquivo: { w: "grifo_branco", b: "grifo_preto" },
    altura: 0.69,
    // grifo branco nasceu de perfil (bico apontando pro eixo X); 90° corrige
    rotacaoExtra: { w: Math.PI / 2, b: 0 },
  },
  b: {
    arquivo: { w: "oraculo_branco", b: "oraculo_preto" },
    altura: 0.69,
    // oráculo branco esculpido levemente virado; -36° recentraliza o rosto
    rotacaoExtra: { w: -0.2 * Math.PI, b: 0 },
  },
  r: {
    arquivo: { w: "gargula_branco", b: "gargula_preto" },
    altura: 0.69,
    // gárgula branca esculpida com a cabeça levemente virada; 18° corrige
    rotacaoExtra: { w: 0.1 * Math.PI, b: 0 },
  },
  q: {
    arquivo: { w: "arquimaga_branco", b: "arquimaga_preto" },
    altura: 0.83,
    rotacaoExtra: { w: 0, b: 0 },
  },
  k: {
    arquivo: { w: "coracao_branco", b: "coracao_preto" },
    altura: 0.725,
    rotacaoExtra: { w: 0, b: 0 },
  },
};
const MODELOS_ESPECIAIS = {}; // tipo -> { w: Object3D, b: Object3D }

async function carregarPecasEspeciais() {
  const loader = new GLTFLoader();
  const tarefas = [];
  for (const [tipo, cfg] of Object.entries(PECAS_ESPECIAIS)) {
    for (const [cor, arquivo] of Object.entries(cfg.arquivo)) {
      tarefas.push(
        (async () => {
          const gltf = await loader.loadAsync(`/models/pecas/${arquivo}.glb`);
          const raiz = gltf.scene;

          const caixa = new THREE.Box3().setFromObject(raiz);
          const altura = caixa.max.y - caixa.min.y;
          raiz.scale.setScalar(cfg.altura / altura);

          const caixaEscalada = new THREE.Box3().setFromObject(raiz);
          raiz.position.y -= caixaEscalada.min.y; // base direto no tabuleiro (traz o próprio pedestal)
          raiz.rotation.y = cfg.rotacaoExtra[cor];

          raiz.traverse((obj) => {
            if (obj.isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              // geometria/material são compartilhados entre todos os .clone()
              // desse tipo/cor — nunca descartar ao remover uma peça
              obj.userData.compartilhado = true;
            }
          });
          (MODELOS_ESPECIAIS[tipo] ??= {})[cor] = raiz;
        })(),
      );
    }
  }
  await Promise.all(tarefas);
}

function construirModeloPeca(tipo, cor) {
  const matRocha = variarMaterial(CORES[cor], 0.05, 0.1);
  const matRuna = variarMaterial(CORES_RUNA[cor], 0.04, 0.05);

  const grupo = new THREE.Group();
  const modeloEspecial = MODELOS_ESPECIAIS[tipo]?.[cor];

  if (modeloEspecial) {
    // peças com modelo especial já trazem o próprio pedestal esculpido
    grupo.add(modeloEspecial.clone());
  } else {
    grupo.add(criarPedestal(matRocha, matRuna));
    grupo.add(CONSTRUTOR_CRIATURA[tipo](matRocha, matRuna));
  }

  grupo.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  grupo.scale.setScalar(ESCALA_PECA[tipo]);
  // criaturas nascem de frente pra +Z; brancas viram 180° pra encarar as pretas
  grupo.rotation.y = cor === "w" ? Math.PI : 0;
  return grupo;
}

class PieceView {
  constructor(tipo, cor, square) {
    this.tipo = tipo;
    this.cor = cor;
    this.square = square;
    this.group = construirModeloPeca(tipo, cor);
    this.escalaBase = ESCALA_PECA[tipo];
    const pos = squareToPos(square);
    this.group.position.set(pos.x, 0, pos.z);
    pecasGrupo.add(this.group);
  }

  async moverPara(squareDestino, duracaoMs = 550) {
    const destinoPos = squareToPos(squareDestino);
    const origemPos = this.group.position.clone();
    const alturaSalto = 0.5;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / duracaoMs);
        const tEase = easeInOutQuad(t);
        this.group.position.x = lerp(origemPos.x, destinoPos.x, tEase);
        this.group.position.z = lerp(origemPos.z, destinoPos.z, tEase);
        this.group.position.y = Math.sin(Math.PI * t) * alturaSalto;
        if (t < 1) {
          requestAnimationFrame(passo);
        } else {
          this.group.position.y = 0;
          this.square = squareDestino;
          resolve();
        }
      };
      requestAnimationFrame(passo);
    });
  }

  async tocarAtaque() {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / 240);
        const s = this.escalaBase * (1 + Math.sin(t * Math.PI) * 0.3);
        this.group.scale.set(s, s, s);
        if (t < 1) {
          requestAnimationFrame(passo);
        } else {
          this.group.scale.setScalar(this.escalaBase);
          resolve();
        }
      };
      requestAnimationFrame(passo);
    });
  }

  /** Promoção: encolhe, troca o modelo (peão -> tipo escolhido) e volta a crescer. */
  async promoverPara(novoTipo) {
    await this._animarEscala(this.escalaBase, 0, 220);

    const posicaoAtual = this.group.position.clone();
    pecasGrupo.remove(this.group);
    descartarGrupo(this.group);
    this.tipo = novoTipo;
    this.escalaBase = ESCALA_PECA[novoTipo];
    this.group = construirModeloPeca(novoTipo, this.cor);
    this.group.position.copy(posicaoAtual);
    this.group.scale.setScalar(0);
    pecasGrupo.add(this.group);

    await this._animarEscala(0, this.escalaBase, 280);
  }

  /** Anima a escala uniforme do grupo entre dois valores (usado na promoção). */
  _animarEscala(de, para, duracaoMs) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / duracaoMs);
        this.group.scale.setScalar(lerp(de, para, easeInOutQuad(t)));
        if (t < 1) {
          requestAnimationFrame(passo);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(passo);
    });
  }

  remover() {
    pecasGrupo.remove(this.group);
    descartarGrupo(this.group);
  }
}

/* ============================================================
   Sistema de destruição — fragmentos de pedra com "gravidade" manual
   ============================================================ */
class DestructionSystem {
  constructor() {
    this.ativos = [];
    this.geometrias = [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.TetrahedronGeometry(0.8),
      new THREE.OctahedronGeometry(0.7),
    ];
  }

  explodir(pieceView) {
    const cor = pieceView.cor === "w" ? 0xa89478 : 0x2b2a30;
    const material = new THREE.MeshStandardMaterial({
      color: cor,
      roughness: 0.55,
      metalness: 0.6,
      flatShading: true,
    });
    const origem = pieceView.group.position.clone();
    origem.y += 0.6;
    pieceView.group.visible = false;

    const qtd = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < qtd; i++) {
      const geo =
        this.geometrias[Math.floor(Math.random() * this.geometrias.length)];
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.position.copy(origem);
      mesh.scale.setScalar(0.08 + Math.random() * 0.12);
      scene.add(mesh);

      const anguloH = Math.random() * Math.PI * 2;
      const forcaH = 1.2 + Math.random() * 2.2;
      this.ativos.push({
        mesh,
        material,
        velocidade: new THREE.Vector3(
          Math.cos(anguloH) * forcaH,
          3 + Math.random() * 2.5,
          Math.sin(anguloH) * forcaH,
        ),
        velAngular: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
        ),
        vida: 1.6 + Math.random() * 0.6,
        idade: 0,
      });
    }
    return esperar(500);
  }

  atualizar(delta) {
    const gravidade = -9.8;
    for (let i = this.ativos.length - 1; i >= 0; i--) {
      const f = this.ativos[i];
      f.idade += delta;
      f.velocidade.y += gravidade * delta;
      f.mesh.position.addScaledVector(f.velocidade, delta);
      f.mesh.rotation.x += f.velAngular.x * delta;
      f.mesh.rotation.y += f.velAngular.y * delta;
      f.mesh.rotation.z += f.velAngular.z * delta;

      if (f.mesh.position.y < 0.02) {
        f.mesh.position.y = 0.02;
        f.velocidade.y *= -0.25;
        f.velocidade.x *= 0.6;
        f.velocidade.z *= 0.6;
      }
      if (f.idade > f.vida) {
        scene.remove(f.mesh);
        this.ativos.splice(i, 1);
        // material é único por explosão — descarta quando o último fragmento dela morre
        if (!this.ativos.some((a) => a.material === f.material)) {
          f.material.dispose();
        }
      }
    }
  }
}

/* ============================================================
   Sistema de ataque — rajada de energia rúnica antes da explosão
   (dourado nas brancas, gelo nas pretas): anel que se expande +
   cacos voando da vítima, ~280ms.
   ============================================================ */
class AttackSystem {
  /** Rajada de runa na posição do alvo, na cor do lado atacante. */
  golpe(posicaoAlvo, corAtacante) {
    const matRuna = new THREE.MeshStandardMaterial({
      color: corAtacante === "w" ? 0xffb347 : 0x6fd0ff,
      emissive: corAtacante === "w" ? 0xff8c1a : 0x2a8fd6,
      emissiveIntensity: 1.4,
      roughness: 0.3,
      transparent: true,
    });

    const anel = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.1, 20), matRuna);
    anel.rotation.x = -Math.PI / 2;
    anel.position.copy(posicaoAlvo);
    anel.position.y += 0.05;
    scene.add(anel);

    const cacos = [];
    for (let i = 0; i < 6; i++) {
      const caco = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.035, 0),
        matRuna,
      );
      caco.position.copy(posicaoAlvo);
      caco.position.y += 0.5;
      scene.add(caco);
      const ang = Math.random() * Math.PI * 2;
      cacos.push({
        mesh: caco,
        dir: new THREE.Vector3(
          Math.cos(ang),
          0.4 + Math.random() * 0.4,
          Math.sin(ang),
        ),
      });
    }

    const t0 = performance.now();
    const duracao = 280;
    return new Promise((resolve) => {
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / duracao);
        anel.scale.setScalar(1 + t * 5);
        matRuna.opacity = 1 - t;
        for (const c of cacos) {
          c.mesh.position.addScaledVector(c.dir, 0.02);
          c.mesh.rotation.x += 0.3;
          c.mesh.rotation.y += 0.3;
        }
        if (t < 1) {
          requestAnimationFrame(passo);
        } else {
          scene.remove(anel);
          for (const c of cacos) scene.remove(c.mesh);
          matRuna.dispose(); // compartilhado entre o anel e os cacos desse golpe só
          resolve();
        }
      };
      requestAnimationFrame(passo);
    });
  }
}

/* ============================================================
   Cara ou coroa — moeda rúnica que gira no ar acima do tabuleiro.
   "w" = caiu cara, "b" = caiu coroa; comparado contra a chamada do
   jogador em chamarMoeda() mais abaixo.
   ============================================================ */
class CoinFlipSystem {
  constructor() {
    this.girando = false;
  }

  // disco + aro entalhado + selo em relevo (dourado/cara, gelo/coroa) —
  // o relevo ajuda a ler como moeda mesmo quase de perfil durante o giro
  construirMoeda() {
    const grupo = new THREE.Group();

    const discoGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 48);
    const matCara = variarMaterial(CORES_RUNA.w, 0, 0);
    matCara.metalness = 0.3;
    const matCoroa = variarMaterial(CORES_RUNA.b, 0, 0);
    matCoroa.metalness = 0.3;
    const disco = new THREE.Mesh(discoGeo, [
      MATERIAL_ENTALHE,
      matCara,
      matCoroa,
    ]);
    disco.castShadow = true;
    grupo.add(disco);

    const aroGeo = new THREE.TorusGeometry(0.44, 0.028, 10, 48);
    const aroCara = new THREE.Mesh(aroGeo, MATERIAL_ENTALHE);
    aroCara.rotation.x = Math.PI / 2;
    aroCara.position.y = 0.061;
    aroCara.castShadow = true;
    grupo.add(aroCara);
    const aroCoroa = aroCara.clone();
    aroCoroa.position.y = -0.061;
    grupo.add(aroCoroa);

    const seloGeo = new THREE.OctahedronGeometry(0.17, 0);
    const seloCara = new THREE.Mesh(
      seloGeo,
      variarMaterial(CORES_RUNA.w, 0.04, 0.05),
    );
    seloCara.scale.y = 0.32;
    seloCara.position.y = 0.09;
    seloCara.castShadow = true;
    grupo.add(seloCara);
    const seloCoroa = new THREE.Mesh(
      seloGeo,
      variarMaterial(CORES_RUNA.b, 0.04, 0.05),
    );
    seloCoroa.scale.y = 0.32;
    seloCoroa.position.y = -0.09;
    seloCoroa.castShadow = true;
    grupo.add(seloCoroa);

    return grupo;
  }

  /** Anima o sorteio; resolve pra "w" (caiu cara) ou "b" (caiu coroa). */
  sortear() {
    if (this.girando) return Promise.resolve(null);
    this.girando = true;
    const resultado = Math.random() < 0.5 ? "w" : "b";

    const moeda = this.construirMoeda();
    moeda.position.set(0, 2.6, 0);
    scene.add(moeda);

    const voltasExtras = 5 + Math.floor(Math.random() * 3); // 5-7 giros completos
    // topo (brancas) fica pra cima em múltiplos de 2π; fundo (pretas) em +π
    const rotacaoFinal =
      voltasExtras * Math.PI * 2 + (resultado === "b" ? Math.PI : 0);
    const y0 = moeda.position.y;
    const duracao = 1500;
    const t0 = performance.now();
    // cambalhota lateral que oscila e amortece até voltar a 0, pra pousar deitada
    const wobbleVoltas = 3 + Math.floor(Math.random() * 2);
    const wobbleAmplitude = 0.4;

    return new Promise((resolve) => {
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / duracao);
        const desaceleracao = 1 - Math.pow(1 - t, 3); // ease-out — a moeda "trava" na rotação final
        moeda.rotation.x = rotacaoFinal * desaceleracao;
        moeda.rotation.z =
          Math.sin(t * Math.PI * wobbleVoltas) * wobbleAmplitude * (1 - t);
        moeda.position.y = y0 + Math.sin(t * Math.PI) * 1.6; // arco de lançada, como jogada pro ar

        if (t < 1) {
          requestAnimationFrame(passo);
        } else {
          moeda.rotation.z = 0; // garante pouso perfeitamente deitado, sem resíduo do amortecimento
          setTimeout(() => {
            scene.remove(moeda);
            this.girando = false;
            resolve(resultado);
          }, 700); // segura a moeda parada e visível por um instante antes de sumir
        }
      };
      requestAnimationFrame(passo);
    });
  }
}
const sistemaMoeda = new CoinFlipSystem();

/* ============================================================
   Peças com vontade própria — reagem diferente se confiam em você
   (seu conjunto) ou não (emprestado, desconfiado).
   ============================================================ */
const FALAS = {
  confiante: {
    idle: [
      "As peças reconhecem sua mão no cabo — lealdade renovada a cada lance.",
      '"Vai com tudo, esse é o seu jogo", sussurra uma pedra.',
      "O Coração pulsa mais forte, discreto — aprova o plano.",
      "Sente o tabuleiro vibrar de confiança sob seus dedos.",
      '"Sabemos o que fazer", ecoa baixinho a Gárgula.',
      'Uma peça cutuca a vizinha: "esse aqui é dos nossos."',
      "O Oráculo resmunga uma bênção baixinho antes do lance.",
    ],
    captura_jogador: [
      "A peça derrubada é arrastada com honra pelas suas — bem jogado.",
      "Suas peças comemoram, discretas: golpe certeiro.",
      "Um brilho de orgulho passa pelo tabuleiro.",
      '"Isso é que é jogar", grasna o Grifo, batendo a garra.',
      "As peças se alinham um pouco mais retas — orgulho puro.",
    ],
    captura_ia: [
      "Suas peças lamentam a perda, mas seguem firmes ao seu lado.",
      "Um momento de silêncio pela peça caída — a lealdade não vacila.",
      '"Vamos vingar essa", promete baixinho uma peça vizinha.',
      '"Não foi sua culpa", murmura o Coração, sem tirar os olhos do tabuleiro.',
      "As peças se aproximam um passo — protegendo o que resta.",
    ],
  },
  desconfiada: {
    idle: [
      'Uma peça resmunga: "não era assim que o dono de verdade jogava..."',
      "O Grifo grasna, desconfiado — obedece, mas sem gosto.",
      '"Você tem certeza disso?" murmura a Arquimaga, no tom mais sarcástico possível.',
      "As peças trocam olhares de pedra — ainda não confiam totalmente em você.",
      "Uma delas sussurra um conselho estranho... melhor ignorar.",
      '"Mãos novas, jogo velho", resmunga a Gárgula, sem entusiasmo.',
      "O Oráculo suspira, pesado — pedra também sabe suspirar, aparentemente.",
    ],
    captura_jogador: [
      '"Golpe eficiente... talvez você mereça um pouco mais de confiança."',
      "As peças observam, ainda cautelosas, mas reconhecem a jogada.",
      '"Nada mal", admite uma Gárgula, relutante.',
      "Um aceno seco — quase seco demais pra ser um elogio.",
      '"Até que enfim um lance decente", cochicha alguém no fundo do tabuleiro.',
    ],
    captura_ia: [
      '"Eu avisei", sussurra uma peça, nada solidária.',
      "As peças trocam olhares — será que confiaram na pessoa errada?",
      'Um resmungo frio: "o dono de verdade não teria perdido essa."',
      '"Típico", murmura o Oráculo, sem disfarçar o desdém.',
      "Ninguém se oferece pra consolar a peça caída dessa vez.",
    ],
  },
};

// evita as peças "falarem" toda hora — pelo menos 1 lance de cada lado de
// intervalo entre uma fala e a próxima, senão vira ruído
function falaDaPeca(orquestrador, contexto, chance) {
  const plyAtual = orquestrador.chess.history().length;
  if (plyAtual < orquestrador.proximaFalaEm) return;
  if (Math.random() > chance) return;
  const grupo =
    FALAS[orquestrador.pecasConfiaveis ? "confiante" : "desconfiada"][contexto];
  if (!grupo || grupo.length === 0) return;
  logMsg(`🗣️ ${grupo[Math.floor(Math.random() * grupo.length)]}`);
  orquestrador.proximaFalaEm = plyAtual + 2;
}

/* ============================================================
   Stockfish rodando em Web Worker (build "lite-single": WASM sem
   threads, sem precisar de cabeçalhos COOP/COEP). Comunicação por
   protocolo UCI via postMessage.
   ============================================================ */
const NIVEIS_STOCKFISH = {
  iniciante: { skill: 2, depth: 6, movetime: 300 },
  intermediario: { skill: 10, depth: 12, movetime: 800 },
  "bruxo-mestre": { skill: 20, depth: 18, movetime: 1800 },
};
// bem acima do maior movetime configurado acima (1800ms) — ver melhorJogada()
const TEMPO_LIMITE_MOTOR_MS = 12000;

// controles de tempo FIDE: tempo inicial + incremento por lance desde o lance 1
// (versão simplificada do clássico, sem a segunda fase de 40 lances)
const CONTROLES_TEMPO = {
  fide: {
    inicialMs: 90 * 60000,
    incrementoMs: 30000,
    nome: "Clássico FIDE (90+30)",
  },
  rapido: {
    inicialMs: 15 * 60000,
    incrementoMs: 10000,
    nome: "Rápido (15+10)",
  },
  blitz: { inicialMs: 3 * 60000, incrementoMs: 2000, nome: "Blitz (3+2)" },
};

function formatarRelogio(ms) {
  const totalSeg = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${min}:${String(seg).padStart(2, "0")}`;
}

class StockfishEngine {
  constructor() {
    this.dificuldade = "intermediario";
    this.falhouInicializar = false;
    this.worker = new Worker("/stockfish/stockfish-19-lite-single.js");
    this.pronto = this._inicializar();
  }

  _aguardarLinha(predicado) {
    return new Promise((resolve) => {
      const aoReceberLinha = (evento) => {
        if (predicado(evento.data)) {
          this.worker.removeEventListener("message", aoReceberLinha);
          resolve(evento.data);
        }
      };
      this.worker.addEventListener("message", aoReceberLinha);
    });
  }

  /** Como _aguardarLinha, mas desiste depois de `limiteMs` e devolve `null`. */
  _aguardarLinhaComLimite(predicado, limiteMs) {
    return Promise.race([
      this._aguardarLinha(predicado),
      esperar(limiteMs).then(() => null),
    ]);
  }

  async _inicializar() {
    this.worker.postMessage("uci");
    const uciok = await this._aguardarLinhaComLimite(
      (linha) => linha === "uciok",
      TEMPO_LIMITE_MOTOR_MS,
    );
    if (uciok === null) {
      // worker não respondeu ao handshake inicial (WASM que não instanciou, etc.)
      console.error(
        `Stockfish não respondeu ao handshake UCI em ${TEMPO_LIMITE_MOTOR_MS}ms.`,
      );
      this.falhouInicializar = true;
      return;
    }
    this._aplicarDificuldade();
    this.worker.postMessage("isready");
    const readyok = await this._aguardarLinhaComLimite(
      (linha) => linha === "readyok",
      TEMPO_LIMITE_MOTOR_MS,
    );
    if (readyok === null) {
      console.error(
        `Stockfish não respondeu a "isready" em ${TEMPO_LIMITE_MOTOR_MS}ms.`,
      );
      this.falhouInicializar = true;
    }
  }

  _aplicarDificuldade() {
    const cfg = NIVEIS_STOCKFISH[this.dificuldade];
    this.worker.postMessage(`setoption name Skill Level value ${cfg.skill}`);
  }

  definirDificuldade(nivel) {
    this.dificuldade = nivel;
    this._aplicarDificuldade();
  }

  /** Recebe FEN atual, devolve o melhor lance em notação UCI (ex: "e2e4", "e7e8q"). */
  async melhorJogada(fen) {
    await this.pronto;
    // worker já provou que não responde — nem tenta postar mensagem
    if (this.falhouInicializar) return this._lanceAleatorio(fen);

    const cfg = NIVEIS_STOCKFISH[this.dificuldade];
    this.worker.postMessage(`position fen ${fen}`);
    const promessaResultado = this._aguardarLinhaComLimite(
      (linha) => linha.startsWith("bestmove"),
      TEMPO_LIMITE_MOTOR_MS,
    );
    this.worker.postMessage(`go depth ${cfg.depth} movetime ${cfg.movetime}`);

    // o worker às vezes não devolve "bestmove" (crash silencioso do WASM)
    // sem disparar erro — sem esse limite, a partida ficava travada pra
    // sempre; se estourar, joga um lance legal aleatório
    const linha = await promessaResultado;
    if (linha === null) {
      console.error(
        `Stockfish não respondeu em ${TEMPO_LIMITE_MOTOR_MS}ms — jogando lance aleatório no lugar.`,
      );
      return this._lanceAleatorio(fen);
    }

    const uci = linha.split(" ")[1]; // ex: "bestmove e2e4 ponder e7e5"
    return uci === "(none)" ? null : uci; // sem lances legais = xeque-mate/afogamento
  }

  /** Fallback pra quando o motor não responde: um lance legal qualquer, só pra a partida não travar. */
  _lanceAleatorio(fen) {
    const lances = new Chess(fen).moves({ verbose: true });
    if (lances.length === 0) return null;
    const lance = lances[Math.floor(Math.random() * lances.length)];
    return lance.from + lance.to + (lance.promotion ?? "");
  }
}

/* ============================================================
   Orquestrador de turnos — a espinha dorsal (lógica síncrona x animação async)
   ============================================================ */
class TurnOrchestrator {
  constructor() {
    this.chess = new Chess();
    this.pecas = new Map(); // square -> PieceView
    this.pontos = { w: 0, b: 0 }; // placar de material capturado por cor
    this.destruicao = new DestructionSystem();
    this.armas = new AttackSystem();
    this.engine = new StockfishEngine();
    this.pecasConfiaveis = true;
    this.proximaFalaEm = 0; // cooldown de falas, em número de lances (ply)
    // trava até apertar "Jogar" no hub, senão o relógio já começaria a
    // contar e a IA poderia abrir sozinha
    this.travado = true;
    this.partidaIniciada = false;
    this.selecionada = null;
    this.marcadores = [];
    this.geracao = 0; // incrementado a cada reinício, invalida continuações async órfãs
    this.modo = "ia"; // "ia" (você x Stockfish) | "local" (dois jogadores no mesmo dispositivo)
    this.corHumano = "w"; // modo "ia": qual cor você controla (o resto é da IA)
    this.corJogador1 = "w"; // modo "local": qual cor é o "jogador 1", só pro rótulo do HUD
    this.controleTempo = "rapido";
    const cfgTempo = CONTROLES_TEMPO[this.controleTempo];
    this.relogio = { w: cfgTempo.inicialMs, b: cfgTempo.inicialMs }; // só o valor exibido — ainda não corre
    this.perdeuPorTempo = null; // cor que ficou sem tempo, ou null
    this.resultadoRegistrado = false; // evita gravar a mesma partida 2x no placar (ver atualizarHUD)
    this._intervalRelogio = null;
    this._ultimoTickRelogio = 0;
    this._sincronizarPecasIniciais();
  }

  /** Destrava input, inicia os relógios e deixa a IA abrir se for o caso.
   *  Chamado ao apertar "Jogar" no hub, ou de novo em reiniciar(). */
  iniciarPartida() {
    this.partidaIniciada = true;
    this.travado = false;
    this.resultadoRegistrado = false;
    this._iniciarRelogios();
    this.atualizarHUD();
    this._jogarPrimeiroLanceIASeNecessario();
  }

  /** (Re)inicia os dois relógios com o controle de tempo atual e começa a contagem. */
  _iniciarRelogios() {
    const cfg = CONTROLES_TEMPO[this.controleTempo];
    this.relogio = { w: cfg.inicialMs, b: cfg.inicialMs };
    this.perdeuPorTempo = null;
    this._ultimoTickRelogio = performance.now();
    clearInterval(this._intervalRelogio);
    this._intervalRelogio = setInterval(() => this._tickRelogio(), 100);
    this._atualizarRelogiosHUD();
  }

  _tickRelogio() {
    const agora = performance.now();
    const delta = agora - this._ultimoTickRelogio;
    this._ultimoTickRelogio = agora;
    if (!this.partidaIniciada || this.perdeuPorTempo || this.chess.isGameOver())
      return;
    const cor = this.chess.turn();
    this.relogio[cor] = Math.max(0, this.relogio[cor] - delta);
    this._atualizarRelogiosHUD();
    if (this.relogio[cor] === 0) this._encerrarPorTempo(cor);
  }

  /** Bandeira caiu: quem ficou sem tempo perde na hora, mesmo em posição vencedora. */
  _encerrarPorTempo(cor) {
    clearInterval(this._intervalRelogio);
    this.perdeuPorTempo = cor;
    this.travado = true;
    this.geracao++; // invalida lance da IA em andamento, se houver
    logMsg(`⏱ Tempo esgotado — ${cor === "w" ? "pretas" : "brancas"} vencem.`);
    this.atualizarHUD();
  }

  _atualizarRelogiosHUD() {
    const elW = document.getElementById("relogio-w");
    const elB = document.getElementById("relogio-b");
    const elCentral = document.getElementById("relogio-central");
    if (!elW || !elB || !elCentral) return;
    const emAndamento =
      this.partidaIniciada && !this.perdeuPorTempo && !this.chess.isGameOver();
    const vez = this.chess.turn();
    elW.classList.toggle("relogio-ativo", emAndamento && vez === "w");
    elB.classList.toggle("relogio-ativo", emAndamento && vez === "b");
    elW.classList.toggle("relogio-baixo", this.relogio.w <= 20000);
    elB.classList.toggle("relogio-baixo", this.relogio.b <= 20000);

    // o relógio central é dinâmico: mostra o tempo de quem tem a vez agora
    elCentral.textContent = formatarRelogio(this.relogio[vez]);
    elCentral.classList.toggle("relogio-central-brancas", vez === "w");
    elCentral.classList.toggle("relogio-central-pretas", vez === "b");
    elCentral.classList.toggle("relogio-baixo", this.relogio[vez] <= 20000);

    // faixa "sua vez": acompanha o cristal aceso do lado da vez
    const elAviso = document.getElementById("aviso-vez");
    if (elAviso) {
      const nomeEl = document.getElementById(vez === "w" ? "nome-w" : "nome-b");
      const nomeAtivo = nomeEl ? nomeEl.textContent : "";
      elAviso.textContent =
        nomeAtivo === "Você"
          ? "Sua vez"
          : nomeAtivo === "IA"
            ? "Vez da IA"
            : `Vez de ${nomeAtivo}`;
      elAviso.classList.toggle("aviso-vez-brancas", vez === "w");
      elAviso.classList.toggle("aviso-vez-pretas", vez === "b");
      elAviso.classList.toggle("aviso-vez-visivel", emAndamento);
    }
  }

  /** Troca o controle de tempo (chamado pelo select de config) — vale a partir da próxima partida. */
  definirControleTempo(valor) {
    this.controleTempo = valor;
  }

  _sincronizarPecasIniciais() {
    for (const linha of this.chess.board()) {
      for (const casa of linha) {
        if (!casa) continue;
        const pv = new PieceView(casa.type, casa.color, casa.square);
        this.pecas.set(casa.square, pv);
      }
    }
  }

  get turnoHumano() {
    if (this.travado) return false;
    if (this.modo === "local") return true; // sempre um humano dos dois lados
    return this.chess.turn() === this.corHumano;
  }

  atualizarHUD() {
    // nome de cada lado no placar — o cristal já mostra de quem é a vez,
    // então o status só precisa falar quando há algo fora do comum a dizer
    // "J1"/"J2" (não "Jogador 1/2") pra caber na caixa sem encostar no
    // relógio central e sem precisar encolher a fonte fora do padrão
    document.getElementById("nome-w").textContent =
      this.modo === "local"
        ? this.corJogador1 === "w"
          ? "J1"
          : "J2"
        : this.corHumano === "w"
          ? "Você"
          : "IA";
    document.getElementById("nome-b").textContent =
      this.modo === "local"
        ? this.corJogador1 === "b"
          ? "J1"
          : "J2"
        : this.corHumano === "b"
          ? "Você"
          : "IA";

    // pontuação embaixo do nome: elo do jogador (derivado do histórico do
    // grimório) nos dois lados no modo local, ou elo vs. um número de
    // sabor pra IA conforme a dificuldade no modo contra a IA
    const eloJogador = calcularEloJogador(lerHistoricoHub());
    const eloIA = ELO_IA_POR_DIFICULDADE[this.engine.dificuldade] ?? 1000;
    document.getElementById("pontos-w").textContent =
      this.modo === "local" || this.corHumano === "w" ? eloJogador : eloIA;
    document.getElementById("pontos-b").textContent =
      this.modo === "local" || this.corHumano === "b" ? eloJogador : eloIA;

    if (!this.partidaIniciada) {
      document.getElementById("status").textContent =
        "configure a partida e aperte Jogar";
    } else if (this.perdeuPorTempo) {
      document.getElementById("status").textContent =
        `Tempo esgotado! ${this.perdeuPorTempo === "w" ? "Pretas" : "Brancas"} vencem.`;
    } else if (this.chess.isCheckmate()) {
      document.getElementById("status").textContent =
        `Ritual quebrado! ${this.chess.turn() === "w" ? "Pretas" : "Brancas"} vencem.`;
    } else if (this.chess.isDraw()) {
      document.getElementById("status").textContent = "Empate.";
    } else if (this.chess.inCheck()) {
      document.getElementById("status").textContent = "Selo ameaçado!";
    } else if (!this.turnoHumano) {
      document.getElementById("status").textContent = "a IA está pensando...";
    } else {
      document.getElementById("status").textContent = "";
    }
    this._atualizarPlacar();
    this._atualizarRelogiosHUD();

    // grava no placar do grimório uma única vez por partida
    if (
      this.partidaIniciada &&
      !this.resultadoRegistrado &&
      (this.perdeuPorTempo || this.chess.isCheckmate() || this.chess.isDraw())
    ) {
      this.resultadoRegistrado = true;
      registrarResultadoHub(this);
    }
  }

  /** Placar de material: soma os pontos das peças capturadas por cada lado. */
  _atualizarPlacar() {
    const { w, b } = this.pontos;
    const el = document.getElementById("placar");
    if (w === 0 && b === 0) {
      el.textContent = "";
      return;
    }
    const vantagem = w - b;
    const sufixo =
      vantagem === 0
        ? ""
        : ` (+${Math.abs(vantagem)} ${vantagem > 0 ? "brancas" : "pretas"})`;
    el.textContent = `Pontos — brancas ${w} · pretas ${b}${sufixo}`;
  }

  limparSelecao() {
    if (this.selecionada) {
      casas.get(this.selecionada).material = casas.get(
        this.selecionada,
      ).userData.materialOriginal;
    }
    this.selecionada = null;
    for (const square of this.marcadores) {
      casas.get(square).material = casas.get(square).userData.materialOriginal;
    }
    this.marcadores = [];
  }

  selecionar(square) {
    const peca = this.pecas.get(square);
    if (!peca || peca.cor !== this.chess.turn()) return;
    this.limparSelecao();
    this.selecionada = square;
    casas.get(square).material = matSelecionada;

    // casas alcançáveis preenchidas de verde (livres) ou vermelho (captura),
    // em vez de uma marcação flutuante — mais legível à distância
    const lances = this.chess.moves({ square, verbose: true });
    for (const lance of lances) {
      casas.get(lance.to).material = lance.captured ? matCaptura : matDestino;
      this.marcadores.push(lance.to);
    }
  }

  async clicarCasa(square) {
    if (!this.turnoHumano) return;

    if (!this.selecionada) {
      this.selecionar(square);
      return;
    }
    if (square === this.selecionada) {
      this.limparSelecao();
      return;
    }
    const alvoValido = this.marcadores.includes(square);
    if (!alvoValido) {
      // clicou noutra peça de quem tem a vez -> reseleciona; senão ignora
      const peca = this.pecas.get(square);
      if (peca && peca.cor === this.chess.turn()) this.selecionar(square);
      return;
    }

    const origem = this.selecionada;
    this.limparSelecao();
    await this.jogarLanceHumano(origem, square);
  }

  /** Interpreta um comando falado ("cavalo para f3") e joga se for inequívoco. */
  async executarComandoDeVoz(textoOriginal) {
    if (!this.turnoHumano) {
      logMsg(`🎤 "${textoOriginal}" — não é sua vez.`);
      return;
    }
    const resultado = interpretarComandoDeVoz(this.chess, textoOriginal);
    if (!resultado || resultado.naoEntendido) {
      logMsg(`🎤 Não entendi o lance: "${textoOriginal}"`);
      return;
    }
    if (resultado.ambiguo) {
      const opcoes = resultado.candidatos.map(descreverLance).join(", ");
      logMsg(`🎤 Ambíguo ("${textoOriginal}") — pode ser: ${opcoes}`);
      return;
    }
    logMsg(`🎤 "${textoOriginal}" → ${descreverLance(resultado)}`);
    this.limparSelecao();
    await this.jogarLanceHumano(resultado.from, resultado.to);
  }

  async jogarLanceHumano(origem, destino) {
    const geracao = this.geracao;
    const promocaoNecessaria = this._precisaPromocao(origem, destino);
    const lance = this.chess.move({
      from: origem,
      to: destino,
      promotion: promocaoNecessaria ? "q" : undefined,
    });
    if (!lance) return;
    if (lance.captured) this.pontos[lance.color] += PONTOS_PECA[lance.captured];
    this.relogio[lance.color] +=
      CONTROLES_TEMPO[this.controleTempo].incrementoMs;

    this.travado = true;
    this.atualizarHUD();
    const rotuloJogador =
      this.modo === "local"
        ? `Jogador ${lance.color === this.corJogador1 ? 1 : 2}`
        : "Você";
    logMsg(`${rotuloJogador}: ${descreverLance(lance)}`);
    await this.executarMovimento3D(lance, geracao);
    if (geracao !== this.geracao) return; // partida foi reiniciada durante a animação
    falaDaPeca(
      this,
      lance.captured ? "captura_jogador" : "idle",
      lance.captured ? 0.5 : 0.08,
    );

    this.travado = false;
    this.atualizarHUD();

    if (this.chess.isGameOver()) return;
    if (this.modo === "ia") {
      await this.jogarLanceIA();
    } else if (this.modo === "local") {
      // trava cliques enquanto a câmera vira; não chama atualizarHUD() de
      // novo aqui — o texto já mostra o turno certo, só os cliques esperam
      this.travado = true;
      await iniciarGiroCamera180();
      if (geracao !== this.geracao) return; // partida foi reiniciada durante o giro
      this.travado = false;
    }
  }

  async jogarLanceIA() {
    const geracao = this.geracao;
    this.travado = true;
    this.atualizarHUD();

    const fen = this.chess.fen();
    const uci = await this.engine.melhorJogada(fen); // 1. IA decide
    if (geracao !== this.geracao) return; // partida foi reiniciada enquanto a IA pensava
    if (!uci) {
      this.travado = false;
      this.atualizarHUD();
      return;
    }

    const origem = uci.slice(0, 2);
    const destino = uci.slice(2, 4);
    const promocao = uci.length > 4 ? uci[4] : undefined;

    const lance = this.chess.move({
      from: origem,
      to: destino,
      promotion: promocao,
    });
    if (!lance) {
      console.error("Motor sugeriu lance ilegal:", uci);
      this.travado = false;
      return;
    }
    if (lance.captured) this.pontos[lance.color] += PONTOS_PECA[lance.captured];
    this.relogio[lance.color] +=
      CONTROLES_TEMPO[this.controleTempo].incrementoMs;
    logMsg(`IA: ${descreverLance(lance)}`);
    await this.executarMovimento3D(lance, geracao); // 2-7
    if (geracao !== this.geracao) return; // partida foi reiniciada durante a animação
    if (lance.captured) falaDaPeca(this, "captura_ia", 0.6);

    this.travado = false;
    this.atualizarHUD();
  }

  _precisaPromocao(origem, destino) {
    const peca = this.pecas.get(origem);
    if (!peca || peca.tipo !== "p") return false;
    const rankDestino = destino[1];
    return rankDestino === "8" || rankDestino === "1";
  }

  /** Sincroniza a animação 3D com um lance já validado no chess.js.
   *  `geracao` é checada a cada await pra abortar se reiniciar() rodou
   *  no meio da animação, evitando escrever peça velha por cima do
   *  mapa lógico da partida nova. */
  async executarMovimento3D(lance, geracao) {
    if (geracao !== this.geracao) return;
    const pecaAtacante = this.pecas.get(lance.from);

    // roque: move a torre também, em paralelo com o rei
    let promessaRoque = null;
    if (lance.flags.includes("k") || lance.flags.includes("q")) {
      const linha = lance.color === "w" ? "1" : "8";
      const torreOrigem = lance.flags.includes("k") ? `h${linha}` : `a${linha}`;
      const torreDestino = lance.flags.includes("k")
        ? `f${linha}`
        : `d${linha}`;
      const torre = this.pecas.get(torreOrigem);
      if (torre) {
        this.pecas.delete(torreOrigem);
        promessaRoque = torre
          .moverPara(torreDestino)
          .then(() => this.pecas.set(torreDestino, torre));
      }
    }

    // en passant: a peça capturada não está na casa de destino
    const squareCapturada = lance.flags.includes("e")
      ? lance.to[0] + lance.from[1]
      : lance.to;

    // 2. Peça inicia animação de andar até a casa alvo
    this.pecas.delete(lance.from);
    await Promise.all(
      [pecaAtacante.moverPara(lance.to), promessaRoque].filter(Boolean),
    );
    if (geracao !== this.geracao) return;

    if (lance.captured) {
      const pecaCapturada = this.pecas.get(squareCapturada);
      // 4. Toca animação de ataque + golpe de arma na vítima
      await Promise.all([
        pecaAtacante.tocarAtaque(),
        pecaCapturada
          ? this.armas.golpe(pecaCapturada.group.position, pecaAtacante.cor)
          : null,
      ]);
      if (geracao !== this.geracao) return;
      // 5. Peça capturada explode em detritos
      if (pecaCapturada) {
        this.pecas.delete(squareCapturada);
        await this.destruicao.explodir(pecaCapturada);
        if (geracao !== this.geracao) return;
        pecaCapturada.remover();
      }
    }

    // 6. Promoção: peão que chegou na última casa vira a peça escolhida
    if (lance.promotion) {
      await pecaAtacante.promoverPara(lance.promotion);
      if (geracao !== this.geracao) return;
    }

    // 7. Tabuleiro lógico (Map de peças) atualizado, turno já passou no chess.js
    this.pecas.set(lance.to, pecaAtacante);
  }

  reiniciar() {
    this.geracao++; // invalida qualquer continuação async da partida anterior
    this.limparSelecao();
    // limpa o grupo visual inteiro, não só o que o mapa lógico ainda conhece
    while (pecasGrupo.children.length > 0) {
      const filho = pecasGrupo.children[0];
      pecasGrupo.remove(filho);
      descartarGrupo(filho);
    }
    this.pecas.clear();
    this.chess = new Chess();
    this.pontos = { w: 0, b: 0 };
    this.proximaFalaEm = 0;
    this._sincronizarPecasIniciais();
    document.getElementById("log").innerHTML = "";
    logMsg("Nova partida.");
    // nova partida sempre começa com as brancas — se a câmera ficou virada
    // pro lado preto de uma partida anterior, gira de volta
    if (cameraViradaParaPreto) iniciarGiroCamera180();
    this.iniciarPartida();
  }

  /** Se a IA ficou com as brancas (você sorteou pretas), ela abre a partida sozinha. */
  _jogarPrimeiroLanceIASeNecessario() {
    if (this.modo === "ia" && this.corHumano !== this.chess.turn()) {
      this.jogarLanceIA();
    }
  }
}

let orquestrador = null;

/* ============================================================
   Input
   ============================================================ */
const raycaster = new THREE.Raycaster();
const ponteiro = new THREE.Vector2();
const planoChao = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// distingue toque/clique (seleciona casa) de arrasto (gira câmera) —
// essencial no celular, onde as duas coisas acontecem na mesma área
const LIMITE_ARRASTO_PX = 8;
const LIMITE_TOQUE_MS = 500;
let inicioToque = null;

renderer.domElement.addEventListener("pointerdown", (evento) => {
  controls.autoRotate = false; // assim que o jogador interage, a câmera para de girar sozinha
  inicioToque = {
    x: evento.clientX,
    y: evento.clientY,
    tempo: performance.now(),
  };
});

renderer.domElement.addEventListener("pointerup", (evento) => {
  if (!inicioToque) return;
  const distancia = Math.hypot(
    evento.clientX - inicioToque.x,
    evento.clientY - inicioToque.y,
  );
  const duracao = performance.now() - inicioToque.tempo;
  inicioToque = null;
  if (distancia > LIMITE_ARRASTO_PX || duracao > LIMITE_TOQUE_MS) return; // foi arrasto de câmera, não seleção

  if (!orquestrador) return; // modelos ainda carregando
  ponteiro.x = (evento.clientX / window.innerWidth) * 2 - 1;
  ponteiro.y = -(evento.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ponteiro, camera);
  const ponto = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(planoChao, ponto)) return;
  const square = squareFromPoint(ponto.x, ponto.z);
  if (!square) return;
  orquestrador.clicarCasa(square);
});

document.getElementById("modo-jogo").addEventListener("change", (e) => {
  if (!orquestrador) return;
  orquestrador.modo = e.target.value;
  document
    .getElementById("campo-dificuldade")
    .classList.toggle("oculto", orquestrador.modo === "local");
  orquestrador.corHumano = "w";
  orquestrador.corJogador1 = "w";
  logMsg(
    orquestrador.modo === "local"
      ? "🎮 Modo: dois jogadores no mesmo dispositivo."
      : "🎮 Modo: contra a IA.",
  );
  orquestrador.reiniciar();
});
// cara ou coroa: o jogador chama um lado antes do giro; quem acerta o
// resultado sorteado "vence" a moeda e começa a partida com as brancas
const botaoCara = document.getElementById("chamar-cara");
const botaoCoroa = document.getElementById("chamar-coroa");
const elResultadoMoeda = document.getElementById("resultado-moeda");
const elResultadoMoedaTexto = document.getElementById("resultado-moeda-texto");
let timeoutResultadoMoeda = null;

/** Mostra o resultado em destaque no centro da tela por 5s (some sozinho). */
function mostrarResultadoMoeda(tituloHtml, subtitulo) {
  clearTimeout(timeoutResultadoMoeda);
  elResultadoMoedaTexto.innerHTML = `${tituloHtml}<span class="resultado-moeda-sub">${subtitulo}</span>`;
  // esconde e força reflow antes de reexibir, pra reiniciar a animação CSS
  elResultadoMoeda.hidden = true;
  void elResultadoMoeda.offsetWidth;
  elResultadoMoeda.hidden = false;
  timeoutResultadoMoeda = setTimeout(() => {
    elResultadoMoeda.hidden = true;
  }, 5000);
}

/** Cara ou coroa do menu de configurações — só usado em pleno jogo (o hub tem seu próprio sorteio, ver mais abaixo). */
async function chamarMoeda(chamada) {
  if (!orquestrador || orquestrador.travado) return;
  modalConfig.fechar(); // volta pra tela da partida na hora, pra ver a moeda girar no tabuleiro
  botaoCara.disabled = true;
  botaoCoroa.disabled = true;
  botaoCara.classList.remove("chamada-vencedora");
  botaoCoroa.classList.remove("chamada-vencedora");
  document.getElementById("status-voz").textContent = "";
  document.getElementById("status").textContent =
    `Chamou ${chamada}... girando a moeda.`;

  const resultado = await sistemaMoeda.sortear(); // "w" = caiu cara, "b" = caiu coroa
  if (!orquestrador) return; // improvável, mas evita crash se algo mudou durante a animação

  const faceSorteada = resultado === "w" ? "cara" : "coroa";
  const venceu = chamada === faceSorteada;
  (venceu
    ? chamada === "cara"
      ? botaoCara
      : botaoCoroa
    : null
  )?.classList.add("chamada-vencedora");

  if (orquestrador.modo === "local") {
    orquestrador.corJogador1 = venceu ? "w" : "b";
  } else {
    orquestrador.corHumano = venceu ? "w" : "b";
  }
  // reiniciar() limpa o log — por isso a mensagem só é logada depois
  orquestrador.reiniciar();
  const subtitulo =
    orquestrador.modo === "local"
      ? venceu
        ? "Jogador 1 venceu e fica com as brancas."
        : "Jogador 1 perdeu — Jogador 2 fica com as brancas."
      : venceu
        ? "Você venceu — joga de brancas."
        : "Você perdeu — a IA joga de brancas.";
  mostrarResultadoMoeda(
    `🪙 Caiu <strong>${faceSorteada.toUpperCase()}</strong>`,
    subtitulo,
  );
  logMsg(`🪙 Você chamou ${chamada}, caiu ${faceSorteada}! ${subtitulo}`);
  botaoCara.disabled = false;
  botaoCoroa.disabled = false;
}
botaoCara.addEventListener("click", () => chamarMoeda("cara"));
botaoCoroa.addEventListener("click", () => chamarMoeda("coroa"));
document.getElementById("dificuldade").addEventListener("change", (e) => {
  if (!orquestrador) return;
  orquestrador.engine.definirDificuldade(e.target.value);
  logMsg(`Dificuldade: ${e.target.value}`);
});
document.getElementById("tempo-partida").addEventListener("change", (e) => {
  if (!orquestrador) return;
  orquestrador.definirControleTempo(e.target.value);
  logMsg(`⏱ Tempo de partida: ${CONTROLES_TEMPO[e.target.value].nome}.`);
  orquestrador.reiniciar(); // troca de controle de tempo vale pra uma partida nova
});
document.getElementById("pecas-proprias").addEventListener("change", (e) => {
  if (!orquestrador) return;
  orquestrador.pecasConfiaveis = e.target.value === "sim";
  logMsg(
    orquestrador.pecasConfiaveis
      ? "🗣️ As peças relaxam — reconhecem que são suas."
      : "🗣️ As peças ficam em guarda — sentem que não são suas.",
  );
});
document.getElementById("reiniciar").addEventListener("click", () => {
  if (!orquestrador) return;
  orquestrador.reiniciar();
});

/* ============================================================
   Hub inicial — tela de configuração antes da primeira partida.
   Modo/dificuldade/cor usam grupos de botões de alternância em vez
   de <select>, pra escolher com um clique.
   ============================================================ */
const hubInicial = document.getElementById("hub-inicial");
const hubCampoDificuldade = document.getElementById("hub-campo-dificuldade");

/* ============================================================
   Grimórios Lendários — histórico de partidas em localStorage.
   Vitórias/empates contra a IA somam "glória" e disputam o topo;
   duelos locais e derrotas só entram no histórico recente.
   ============================================================ */
const CHAVE_HISTORICO_HUB = "xadrezBruxos.historico";
const GLORIA_POR_DIFICULDADE = {
  iniciante: 10,
  intermediario: 20,
  "bruxo-mestre": 35,
};
const NOME_DIFICULDADE_HUB = {
  iniciante: "Aprendiz",
  intermediario: "Intermediário",
  "bruxo-mestre": "Mestre",
};
// pontuação de sabor pro lado da IA no placar — não é um elo de verdade,
// só um número maior conforme a dificuldade, pro placar mostrar "alguém do outro lado"
const ELO_IA_POR_DIFICULDADE = {
  iniciante: 800,
  intermediario: 1400,
  "bruxo-mestre": 2200,
};

function lerHistoricoHub() {
  try {
    const bruto = localStorage.getItem(CHAVE_HISTORICO_HUB);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return []; // JSON corrompido ou localStorage indisponível — recomeça vazio
  }
}

function gravarHistoricoHub(lista) {
  try {
    localStorage.setItem(
      CHAVE_HISTORICO_HUB,
      JSON.stringify(lista.slice(0, 50)),
    );
  } catch {
    // modo privado / quota excedida — a partida ainda funciona, só não persiste
  }
}

function registrarResultadoHub(orq) {
  const data = new Date().toISOString();
  let entrada;
  if (orq.modo === "local") {
    const vencedor = orq.perdeuPorTempo
      ? orq.perdeuPorTempo === "w"
        ? "b"
        : "w"
      : orq.chess.isCheckmate()
        ? orq.chess.turn() === "w"
          ? "b"
          : "w"
        : null; // null = empate
    entrada = {
      data,
      modo: "local",
      resultado: vencedor ? "vitoria" : "empate",
      dificuldade: null,
      corVencedora: vencedor,
      pontos: 0,
    };
  } else {
    const corHumano = orq.corHumano;
    let resultado;
    if (orq.perdeuPorTempo)
      resultado = orq.perdeuPorTempo === corHumano ? "derrota" : "vitoria";
    else if (orq.chess.isCheckmate())
      resultado = orq.chess.turn() === corHumano ? "derrota" : "vitoria";
    else resultado = "empate";
    const base = GLORIA_POR_DIFICULDADE[orq.engine.dificuldade] ?? 15;
    const pontos =
      resultado === "vitoria"
        ? base
        : resultado === "empate"
          ? Math.round(base / 2)
          : 0;
    entrada = {
      data,
      modo: "ia",
      resultado,
      dificuldade: orq.engine.dificuldade,
      corVencedora: null,
      pontos,
    };
  }
  const historico = lerHistoricoHub();
  historico.unshift(entrada);
  gravarHistoricoHub(historico);
}

function formatarDataHub(iso) {
  return new Date(iso).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
  });
}

/** Uma linha do índice de líderes: rank + nome + pontuação, com leader pontilhado. */
function linhaIndice(rank, nome, pontos) {
  return `<li><span class="indice-rank">${rank}.</span><span class="indice-nome">${nome}</span><span class="indice-leader"></span><span class="indice-pontos">${pontos}</span></li>`;
}

function renderizarPlacarHub() {
  const historico = lerHistoricoHub();
  const topoEl = document.getElementById("hub-placar-topo");
  const recentesEl = document.getElementById("hub-placar-recentes");
  const limparBtn = document.getElementById("hub-placar-limpar");

  const legendarios = historico
    .filter((e) => e.modo === "ia" && e.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 5);

  if (legendarios.length === 0) {
    topoEl.innerHTML =
      '<p class="indice-vazio">O grimório ainda não registou nenhuma vitória. Vença a vossa primeira partida contra a IA para a inscrever aqui.</p>';
  } else {
    const numerais = ["I", "II", "III", "IV", "V"];
    topoEl.innerHTML =
      '<ol class="indice-lideres">' +
      legendarios
        .map((e, i) => {
          const rotulo = `Você — ${e.resultado === "vitoria" ? "vitória" : "empate"} vs. ${NOME_DIFICULDADE_HUB[e.dificuldade] ?? ""}`;
          return linhaIndice(numerais[i], rotulo, e.pontos);
        })
        .join("") +
      "</ol>";
  }

  const recentes = historico.slice(0, 5);
  if (recentes.length === 0) {
    recentesEl.innerHTML =
      '<li class="indice-vazio">Nenhuma partida registada ainda.</li>';
  } else {
    recentesEl.innerHTML = recentes
      .map((e) => {
        const rotuloResultado =
          e.modo === "local"
            ? e.resultado === "empate"
              ? "Empate"
              : `Vitória das ${e.corVencedora === "w" ? "Brancas" : "Pretas"}`
            : e.resultado === "vitoria"
              ? "Vitória"
              : e.resultado === "derrota"
                ? "Derrota"
                : "Empate";
        const rotuloModo =
          e.modo === "local"
            ? "Duelo Local"
            : `Contra a IA · ${NOME_DIFICULDADE_HUB[e.dificuldade] ?? ""}`;
        return `<li>${rotuloResultado} — ${rotuloModo} · ${formatarDataHub(e.data)}</li>`;
      })
      .join("");
  }

  limparBtn.hidden = historico.length === 0;
  renderizarPerfilHub(historico);
}

/** Elo simplificado do jogador — não é rating de verdade, só um resumo derivado do histórico. */
function calcularEloJogador(historico) {
  const derrotas = historico.filter((e) => e.resultado === "derrota").length;
  const gloriaTotal = historico.reduce((soma, e) => soma + (e.pontos || 0), 0);
  return Math.max(600, 1000 + gloriaTotal * 2 - derrotas * 10);
}

/** Perfil na fita lateral: nível, vitórias, derrotas e elo simplificado, tudo derivado do histórico. */
function renderizarPerfilHub(historico) {
  const vitorias = historico.filter((e) => e.resultado === "vitoria").length;
  const derrotas = historico.filter((e) => e.resultado === "derrota").length;
  const nivel = 1 + Math.floor(historico.length / 5);

  document.getElementById("perfil-nivel").textContent = nivel;
  document.getElementById("perfil-vitorias").textContent = vitorias;
  document.getElementById("perfil-derrotas").textContent = derrotas;
  document.getElementById("perfil-elo").textContent =
    calcularEloJogador(historico);
}

renderizarPlacarHub();

document.getElementById("hub-placar-limpar").addEventListener("click", () => {
  if (
    !confirm(
      "Apagar todo o histórico de partidas do grimório? Esta ação não pode ser desfeita.",
    )
  ) {
    return;
  }
  gravarHistoricoHub([]);
  renderizarPlacarHub();
});

/** Liga um grupo de botões de alternância: clique troca `.ativo` e atualiza
 *  `dataset.valor` no grupo. `aoTrocar` é opcional, pra efeitos colaterais. */
function ligarToggleGrupo(idGrupo, aoTrocar) {
  const grupo = document.getElementById(idGrupo);
  grupo.addEventListener("click", (evento) => {
    const botao = evento.target.closest(".toggle-btn");
    if (!botao || botao.classList.contains("ativo")) return;
    grupo
      .querySelectorAll(".toggle-btn")
      .forEach((b) => b.classList.toggle("ativo", b === botao));
    grupo.dataset.valor = botao.dataset.valor;
    aoTrocar?.(botao.dataset.valor);
  });
  return grupo;
}

ligarToggleGrupo("hub-modo-jogo", (valor) => {
  hubCampoDificuldade.classList.toggle("oculto", valor === "local");
});
ligarToggleGrupo("hub-dificuldade");
ligarToggleGrupo("hub-cor");

// visual do tabuleiro: pré-visualiza na hora (o tabuleiro já está visível
// atrás do hub, então trocar o material é feedback imediato, sem esperar "Jogar")
document
  .getElementById("hub-visual-tabuleiro")
  .addEventListener("change", (e) => {
    aplicarEstiloTabuleiro(e.target.value);
  });

/** Lê modo/dificuldade/tempo do hub e aplica no orquestrador — chamado ao apertar Jogar. */
/** Fecha o hub com o mergulho (livro encolhe/desfoca + câmera avança) em
 *  vez do corte seco de hidden=true. */
function fecharHubComTransicao() {
  hubInicial.classList.add("hub-mergulhando");
  iniciarMergulhoCamera();
  return esperar(650).then(() => {
    hubInicial.hidden = true;
  });
}

function aplicarConfigHub() {
  orquestrador.modo = document.getElementById("hub-modo-jogo").dataset.valor;
  orquestrador.engine.definirDificuldade(
    document.getElementById("hub-dificuldade").dataset.valor,
  );
  orquestrador.definirControleTempo(
    document.getElementById("hub-tempo-partida").value,
  );
}

const botaoSeloJogar = document.getElementById("hub-jogar");
botaoSeloJogar.addEventListener("click", async () => {
  if (!orquestrador) return;
  // selo de cera prensado: feedback pesado de propósito, pra confirmar uma
  // decisão que já aplica todas as escolhas (não é um toggle qualquer)
  botaoSeloJogar.classList.add("selando");
  botaoSeloJogar.disabled = true;
  await esperar(380);
  botaoSeloJogar.classList.remove("selando");

  aplicarConfigHub();
  const corEscolhida = document.getElementById("hub-cor").dataset.valor; // "w" | "b" | "random"

  if (corEscolhida !== "random") {
    if (orquestrador.modo === "local") orquestrador.corJogador1 = corEscolhida;
    else orquestrador.corHumano = corEscolhida;
    await fecharHubComTransicao();
    orquestrador.iniciarPartida();
    return;
  }

  // cor aleatória: fecha o hub já, pra ver a moeda girar no tabuleiro,
  // e só então sorteia — mesmo floreio visual do cara-ou-coroa do menu
  await fecharHubComTransicao();
  document.getElementById("status-voz").textContent = "";
  document.getElementById("status").textContent =
    "Sorteando a cor... girando a moeda.";
  const resultado = await sistemaMoeda.sortear(); // "w" ou "b"
  if (!orquestrador) return;
  if (orquestrador.modo === "local") orquestrador.corJogador1 = resultado;
  else orquestrador.corHumano = resultado;
  const nomeCor = resultado === "w" ? "brancas" : "pretas";
  const subtitulo =
    orquestrador.modo === "local"
      ? `Jogador 1 começa jogando de ${nomeCor}.`
      : `Você joga de ${nomeCor}.`;
  orquestrador.iniciarPartida();
  mostrarResultadoMoeda(
    `🪙 Caiu <strong>${nomeCor.toUpperCase()}</strong>`,
    subtitulo,
  );
  logMsg(`🪙 Sorteio da cor: ${subtitulo}`);
});

/* ============================================================
   Voz — Web Speech API. Botão de "aperte pra falar" (não fica ouvindo
   o tempo todo); o texto reconhecido passa por interpretarComandoDeVoz.
   ============================================================ */
const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const botaoVoz = document.getElementById("botao-voz");
const statusVoz = document.getElementById("status-voz");

if (!SpeechRecognitionCtor) {
  botaoVoz.disabled = true;
  botaoVoz.title = "Reconhecimento de voz não suportado neste navegador";
  statusVoz.textContent = "Comando de voz indisponível neste navegador.";
} else {
  const reconhecimento = new SpeechRecognitionCtor();
  reconhecimento.lang = "pt-BR";
  reconhecimento.continuous = false;
  reconhecimento.interimResults = false;
  reconhecimento.maxAlternatives = 1;

  let escutando = false;

  reconhecimento.onresult = (evento) => {
    const texto = evento.results[0][0].transcript;
    statusVoz.textContent = `Ouvido: "${texto}"`;
    orquestrador?.executarComandoDeVoz(texto);
  };
  reconhecimento.onerror = (evento) => {
    statusVoz.textContent = `Erro ao ouvir (${evento.error}).`;
  };
  reconhecimento.onend = () => {
    escutando = false;
    botaoVoz.classList.remove("escutando");
  };

  botaoVoz.addEventListener("click", () => {
    if (!orquestrador) return;
    if (escutando) {
      reconhecimento.stop();
      return;
    }
    if (!orquestrador.turnoHumano) {
      statusVoz.textContent = "Espere sua vez pra falar o lance.";
      return;
    }
    escutando = true;
    botaoVoz.classList.add("escutando");
    statusVoz.textContent = "Ouvindo...";
    reconhecimento.start();
  });
}

/* ============================================================
   Loop principal
   ============================================================ */
let ultimoTempo = performance.now();
function animar() {
  requestAnimationFrame(animar);
  const agora = performance.now();
  const delta = Math.min(0.05, (agora - ultimoTempo) / 1000);
  ultimoTempo = agora;
  const t = agora / 1000;

  tochas.forEach((luz, i) => {
    luz.intensity =
      intensidadeBaseTocha[i] +
      Math.sin(t * 6 + i * 10) * 0.12 +
      (Math.random() - 0.5) * 0.08;
  });

  orquestrador?.destruicao.atualizar(delta);
  avancarGiroCamera(agora);
  avancarMergulhoCamera(agora);
  controls.update();
  renderer.render(scene, camera);
}
animar();

/* ============================================================
   Inicialização — carrega os modelos esculpidos antes de montar o tabuleiro
   ============================================================ */
async function iniciar() {
  logMsg("Preparando o tabuleiro...");
  document.getElementById("status").textContent = "preparando o tabuleiro...";
  try {
    await Promise.all([criarMarcacoesTabuleiro(), carregarPecasEspeciais()]);
  } catch (erro) {
    // sem isso, uma falha de rede/asset deixava o botão "Carregando..."
    // travado pra sempre, sem nenhuma pista pro jogador do que aconteceu
    console.error("Falha ao carregar modelos/fontes:", erro);
    document.getElementById("status").textContent =
      "Falha ao carregar os modelos 3D. Recarregue a página.";
    logMsg(
      "⚠️ Não foi possível carregar todos os modelos/fontes — recarregue a página.",
    );
    return;
  }

  orquestrador = new TurnOrchestrator();
  orquestrador.atualizarHUD();
  document.getElementById("log").innerHTML = "";
  logMsg(
    "Bem-vindo à Abertura do Grimório. Configure a partida e aperte Jogar.",
  );

  const botaoHubJogar = document.getElementById("hub-jogar");
  botaoHubJogar.disabled = false;
  botaoHubJogar.textContent = "► Iniciar Partida";
}
iniciar();
