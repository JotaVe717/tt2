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
    console.log("RESPOSTA DO SUBSCRIBE:", JSON.stringify(dadosSub).slice(0, 300));

    // Salva a resposta do subscribe no Supabase (tabela eventos_raid)
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
    console.log("Atualizando ficha completa do clã (clan_data)...");
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
          "name", "player_code", "max_stage", "raid_wildcard_count", "total_raid_player_xp",
          "player_raid_level", "summon_level", "total_card_level",
          "role", "weekly_ticket_count", "titan_cards", "boosted_cards"
        ]
      })
    });

    const textoOuJson = await resposta.json();
    
    if (resposta.ok && (textoOuJson.clan_name || textoOuJson.members || textoOuJson.leaderboard)) {
      await supabase.from("dados_cla").upsert({
        id: 1,
        atualizado_em: new Date().toISOString(),
        dados: textoOuJson
      });
      console.log(`Ficha do clã '${textoOuJson.clan_name || "Macacos Hidráulicos"}' salva com sucesso no Supabase!`);
    } else {
      console.warn("Aviso ao buscar clan_data:", JSON.stringify(textoOuJson).slice(0, 200));
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

// Captura QUALQUER evento que vier da GameHive
socket.onAny(async (nomeEvento, pacoteDeDados) => {
  if (nomeEvento !== "connected") {
    // Exibe no console apenas eventos importantes para não poluir
    if (["attack", "start_attack", "raid_sub_cycle", "cycle_reset"].includes(nomeEvento)) {
      console.log("Evento relevante recebido ao vivo:", nomeEvento);
    }
    await supabase.from("eventos_raid").insert({
      tipo_evento: nomeEvento,
      dados: pacoteDeDados || {}
    });
  }
});

// Atualiza a ficha do clã a cada 12 horas automaticamente
setInterval(atualizarFichaDoCla, 12 * 60 * 60 * 1000);

// Servidor HTTP simples para manter o bot ativo em plataformas como Render
http.createServer((req, res) => res.end("Ponte TT2 Online!")).listen(process.env.PORT || 3000);