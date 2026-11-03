const { io } = require("socket.io-client");
const { createClient } = require("@supabase/supabase-js");
const http = require("http");

// Chaves que você vai colar lá no painel do servidor (Passo 3)
const GAMEHIVE_TOKEN = process.env.GAMEHIVE_TOKEN;
const PLAYER_TOKEN = process.env.PLAYER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Conecta ao Canal Ao Vivo (/raid) exigido pela GameHive
const socket = io("wss://tt2-public.gamehivegames.com/raid", {
  path: "/api",
  transports: ["websocket"],
  reconnectionAttempts: 3,
  extraHeaders: {
    "API-Authenticate": GAMEHIVE_TOKEN
  }
});

// Função que avisa a GameHive para vigiar o seu clã e puxa a ficha completa
async function assinarEPuxarDados() {
  try {
    // 1. Assina os avisos da Raid do clã
    await fetch("https://tt2-public.gamehivegames.com/raid/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "API-Authenticate": GAMEHIVE_TOKEN
      },
      body: JSON.stringify({ player_tokens: [PLAYER_TOKEN] })
    });
    console.log("Clã assinado com sucesso para receber ataques ao vivo!");

    // 2. Pede a ficha completa do clã (cartas, níveis, moral)
    await atualizarFichaDoCla();
  } catch (erro) {
    console.error("Erro ao assinar ou buscar dados:", erro);
  }
}

async function atualizarFichaDoCla() {
  try {
    const resposta = await fetch("https://tt2-public.gamehivegames.com/raid/clan_data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "API-Authenticate": GAMEHIVE_TOKEN
      },
      body: JSON.stringify({
        player_token: PLAYER_TOKEN,
        properties: [
          "max_stage", "raid_wildcard_count", "total_raid_player_xp",
          "player_raid_level", "summon_level", "total_card_level",
          "role", "weekly_ticket_count", "titan_cards", "boosted_cards"
        ]
      })
    });

    if (resposta.ok) {
      const dadosCla = await resposta.json();
      await supabase.from("dados_cla").upsert({
        id: 1,
        atualizado_em: new Date().toISOString(),
        dados: dadosCla
      });
      console.log("Ficha completa do clã salva no Cofre!");
    }
  } catch (erro) {
    console.error("Erro ao atualizar ficha de 12h:", erro);
  }
}

// Quando conectar ao vivo, assina o clã
socket.on("connected", () => {
  console.log("Conectado ao canal ao vivo da GameHive!");
  assinarEPuxarDados();
});

// Registra automaticamente todos os eventos ao vivo da Raid no Cofre
const eventosParaVigiar = [
  "start_attack", "attack", "start", "sub_start", "end",
  "retire", "cycle_reset", "sub_cycle", "target",
  "join", "leave", "kick", "morale", "clan_sync"
];

eventosParaVigiar.forEach((nomeEvento) => {
  socket.on(nomeEvento, async (pacoteDeDados) => {
    console.log("Novo evento recebido ao vivo:", nomeEvento);
    await supabase.from("eventos_raid").insert({
      tipo_evento: nomeEvento,
      dados: pacoteDeDados
    });
  });
});

// Repete a consulta da ficha completa a cada 12 horas (regra da GameHive)
setInterval(atualizarFichaDoCla, 12 * 60 * 60 * 1000);

// Mantém uma porta aberta para o servidor na nuvem saber que o robô está vivo
http.createServer((req, res) => res.end("Ponte TT2 Online!")).listen(process.env.PORT || 3000);