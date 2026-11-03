const { io } = require("socket.io-client");
const { createClient } = require("@supabase/supabase-js");
const http = require("http");

const GAMEHIVE_TOKEN = process.env.GAMEHIVE_TOKEN;
const PLAYER_TOKEN = process.env.PLAYER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const socket = io("wss://tt2-public.gamehivegames.com/raid", {
  path: "/api",
  transports: ["websocket"],
  reconnectionAttempts: 5,
  extraHeaders: {
    "API-Authenticate": GAMEHIVE_TOKEN
  }
});

async function assinarEPuxarDados() {
  try {
    // Espera 2 segundos após conectar ao vivo para garantir que a GameHive registrou a sessão
    await new Promise(r => setTimeout(r, 2000));

    // 1. Assina os avisos da Raid do clã e LÊ a resposta real
    const resSub = await fetch("https://tt2-public.gamehivegames.com/raid/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "API-Authenticate": GAMEHIVE_TOKEN
      },
      body: JSON.stringify({ player_tokens: [PLAYER_TOKEN] })
    });

    const dadosSub = await resSub.json();
    console.log("RESPOSTA DO SUBSCRIBE:", JSON.stringify(dadosSub));

    // Salva a resposta do subscribe no Cofre para você ver no site também
    await supabase.from("eventos_raid").insert({
      tipo_evento: "status_assinatura",
      dados: dadosSub
    });

    // 2. Pede a ficha completa do clã
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

    const textoOuJson = await resposta.json();
    console.log("RESPOSTA DO CLAN_DATA:", JSON.stringify(textoOuJson).slice(0, 300));

    if (resposta.ok && textoOuJson.clan_name) {
      await supabase.from("dados_cla").upsert({
        id: 1,
        atualizado_em: new Date().toISOString(),
        dados: textoOuJson
      });
      console.log("Ficha completa do clã salva no Cofre!");
    }
  } catch (erro) {
    console.error("Erro ao atualizar ficha de 12h:", erro);
  }
}

socket.on("connected", () => {
  console.log("Conectado ao canal ao vivo da GameHive!");
  assinarEPuxarDados();
});

socket.on("disconnect", (motivo) => {
  console.log("Desconectado da GameHive. Motivo:", motivo);
});

socket.on("error", (erro) => {
  console.log("Erro no canal ao vivo:", erro);
});

socket.on("connect_error", (erro) => {
  console.log("Erro ao conectar no canal ao vivo:", erro.message || erro);
});

// Captura QUALQUER evento que vier da GameHive (mesmo que tenha nome diferente)
socket.onAny(async (nomeEvento, pacoteDeDados) => {
  console.log("Evento recebido ao vivo:", nomeEvento);
  if (nomeEvento !== "connected") {
    await supabase.from("eventos_raid").insert({
      tipo_evento: nomeEvento,
      dados: pacoteDeDados || {}
    });
  }
});

setInterval(atualizarFichaDoCla, 12 * 60 * 60 * 1000);

http.createServer((req, res) => res.end("Ponte TT2 Online!")).listen(process.env.PORT || 3000);