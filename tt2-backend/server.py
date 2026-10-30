import os
import asyncio
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn
import discord
from discord import app_commands
from discord.ext import commands
from supabase import create_client, Client
import socketio

# ==============================================================================
# CONFIGURAÇÕES E CREDENCIAIS
# ==============================================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hqhirsnowapylfwhvduf.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxaGlyc25vd2FweWxmd2h2ZHVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjkzNTkxOCwiZXhwIjoyMTA4NTExOTE4fQ.sAZeXN1XFKDh0gVGBomanuHM6GkcEto8AmxZzNRehpI")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "MTU2MzkxNzM2MzA1MTc2NTgwMA.GKB_RY.sfvhh8Bl-KcWAZSsS3Oysz1C9fekI2f4iBmnxI")
DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "1563917363051765800")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "47b-OBWMLXA1SJX_XY2l0lciwaO-zLmJ")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/callback/discord")
FRONTEND_REDIRECT_URL = os.getenv("FRONTEND_REDIRECT_URL", "http://localhost:8000/perfil.html")

GAMEHIVE_KEY = "cd880d55-80c3-44cf-9857-e4ab5ccdaa0a"
MEU_TOKEN_MESTRE = "a91e7f5c-6bd9-4276-b882-a3667ed77263"

TITAN_NAMES = {
    "Enemy1": "Lojak", "Enemy2": "Takedar", "Enemy3": "Jukk", "Enemy4": "Sterl",
    "Enemy5": "Mohaca", "Enemy6": "Terro", "Enemy7": "Klonk", "Enemy8": "Priker"
}

TITAN_PARTS_PT = {
    "ArmorHead": "Cabeça (Armadura)", "ArmorChestUpper": "Peito (Armadura)",
    "ArmorArmUpperRight": "Braço Dir (Armadura)", "ArmorArmUpperLeft": "Braço Esq (Armadura)",
    "ArmorLegUpperRight": "Perna Dir (Armadura)", "ArmorLegUpperLeft": "Perna Esq (Armadura)",
    "ArmorHandRight": "Mão Dir (Armadura)", "ArmorHandLeft": "Mão Esq (Armadura)",
    "BodyHead": "Cabeça (Corpo)", "BodyChestUpper": "Peito (Corpo)",
    "BodyArmUpperRight": "Braço Dir (Corpo)", "BodyArmUpperLeft": "Braço Esq (Corpo)",
    "BodyLegUpperRight": "Perna Dir (Corpo)", "BodyLegUpperLeft": "Perna Esq (Corpo)",
    "BodyHandRight": "Mão Dir (Corpo)", "BodyHandLeft": "Mão Esq (Corpo)",
    "SkeletonHead": "Cabeça (Esqueleto)", "SkeletonChestUpper": "Peito (Esqueleto)",
    "SkeletonArmUpperRight": "Braço Dir (Esqueleto)", "SkeletonArmUpperLeft": "Braço Esq (Esqueleto)",
    "SkeletonLegUpperRight": "Perna Dir (Esqueleto)", "SkeletonLegUpperLeft": "Perna Esq (Esqueleto)",
    "SkeletonHandRight": "Mão Dir (Esqueleto)", "SkeletonHandLeft": "Mão Esq (Esqueleto)"
}

# ==============================================================================
# INICIALIZAÇÃO FASTAPI & DISCORD BOT
# ==============================================================================
intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)
sio = socketio.AsyncClient(reconnection=True, reconnection_attempts=10, reconnection_delay=3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(bot.start(DISCORD_BOT_TOKEN))
    asyncio.create_task(iniciar_socket_gamehive())
    asyncio.create_task(extrair_dados_cla())
    yield

app = FastAPI(title="TT2 Backend API & Advanced Socket Bridge", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ==============================================================================
# COMUNICAÇÃO SUPABASE & SOCKET.IO
# ==============================================================================
async def salvar_no_supabase(tipo_evento: str, payload: dict):
    # Executa a inserção num loop assíncrono separado para não bloquear o socket
    def insert_sync():
        try:
            supabase.table("eventos_raid").insert({
                "tipo_evento": tipo_evento,
                "dados": payload
            }).execute()
        except Exception as e:
            print(f"❌ Erro ao guardar no Supabase: {e}")
            
    await asyncio.to_thread(insert_sync)

@sio.on('*', namespace='/raid')
async def catch_all_raid(event, *args):
    data = args[0] if args else {}
    print(f"📥 [Evento /raid] -> '{event}'")
    event_str = str(event).lower()
    
    if event_str == "attack":
        jogador = data.get("player", {}).get("name") or data.get("player_name", "Desconhecido")
        player_code = data.get("player", {}).get("player_code") or data.get("player_code", "-")
        
        dano_total = 0
        cards_damage = data.get("attack_log", {}).get("cards_damage", [])
        for card in cards_damage:
            for log in card.get("damage_log", []):
                dano_total += log.get("value", 0)
                log["id_pt"] = TITAN_PARTS_PT.get(log.get("id"), log.get("id"))
                
        if dano_total == 0 and "damage" in data:
            dano_total = data.get("damage", 0)

        tita_raw = data.get("raid_state", {}).get("current", {}).get("enemy_id") or data.get("titan_name", "-")
        tita_nome = TITAN_NAMES.get(tita_raw, tita_raw)
        
        ataque_payload = {
            "tipo_evento": "ataque_processado",
            "attacks": [{
                "player_name": jogador,
                "player_code": player_code,
                "damage": dano_total,
                "titan_name": tita_nome,
                "parts": cards_damage
            }],
            "cycle": data.get("cycle", 0),
            "raid_state": data.get("raid_state", {})
        }
        await salvar_no_supabase("ataque_processado", ataque_payload)
    else:
        await salvar_no_supabase(f"raid_{event}", data)

@sio.on("*", namespace="/player")
async def catch_all_player(event, *args):
    data = args[0] if args else {}
    print(f"📥 [Evento /player] -> '{event}'")
    await salvar_no_supabase(f"player_{event}", data)

async def iniciar_socket_gamehive():
    headers = {"API-Authenticate": GAMEHIVE_KEY}
    while True:
        try:
            await sio.connect("https://tt2-public.gamehivegames.com", namespaces=["/raid", "/player"], transports=["websocket"], socketio_path="/api/socket.io", headers=headers)
            async with httpx.AsyncClient() as client:
                await client.post("https://tt2-public.gamehivegames.com/raid/subscribe", json={"player_tokens": [MEU_TOKEN_MESTRE]}, headers=headers)
            await sio.wait()
        except Exception:
            await asyncio.sleep(10)

# ==============================================================================
# CRON JOBS E ENDPOINTS
# ==============================================================================
async def extrair_dados_cla():
    await asyncio.sleep(60)
    while True:
        propriedades = [
            "name", "role", "max_stage", "player_raid_level", "total_raid_player_xp", 
            "weekly_ticket_count", "raid_wildcard_count", "summon_level", "total_card_level", 
            "titan_cards", "boosted_cards"
        ]
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.post(
                    "https://tt2-public.gamehivegames.com/api/raid/clan_data",
                    json={"player_token": MEU_TOKEN_MESTRE, "properties": propriedades},
                    headers={"API-Authenticate": GAMEHIVE_KEY, "Content-Type": "application/json"}
                )
                if res.status_code == 200:
                    await salvar_no_supabase("roster_cla", res.json())
        except Exception:
            pass
        await asyncio.sleep(43200)

@bot.tree.command(name="vincular", description="Vincula seu Token da API da Game Hive ao seu Discord")
async def vincular(interaction: discord.Interaction, token: str):
    await interaction.response.defer(ephemeral=True)
    token_limpo = token.strip()
    clan_code = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://tt2-public.gamehivegames.com/api/player/info", headers={"Authorization": f"Bearer {token_limpo}"})
            if resp.status_code == 200:
                clan_code = resp.json().get("clan", {}).get("code") or resp.json().get("clan_code")
    except Exception: pass
    try:
        res = supabase.table("jogadores_tt2").upsert({"discord_id": str(interaction.user.id), "discord_username": str(interaction.user), "player_api_token": token_limpo, "clan_code": clan_code}).execute()
        if res.data: await interaction.followup.send(f"✅ Conta vinculada! Clã: `{clan_code or 'Nenhum'}`", ephemeral=True)
    except Exception as e: await interaction.followup.send(f"❌ Erro: {e}", ephemeral=True)

@bot.event
async def on_ready(): await bot.tree.sync()

@app.get("/api/jogador/{discord_id}/perfil-completo")
async def get_player_full_data(discord_id: str):
    res = supabase.table("jogadores_tt2").select("player_api_token").eq("discord_id", discord_id).execute()
    if not res.data: raise HTTPException(status_code=404, detail="Jogador não cadastrado.")
    
    todas_propriedades = [
        "player_code", "country_code", "max_stage", "crafting_shards_spent", "raid_wildcard_count", 
        "additive_relic_multiplier", "relics_received", "relics_spent", "summon_level", "name", 
        "total_tournaments", "undisputed_count", "titan_points", "total_raid_player_xp", 
        "player_raid_level", "total_card_level", "equipment_set_count", "total_pet_levels", 
        "total_skill_points", "total_helper_weapons", "total_clan_scrolls", 
        "challenge_tournaments_participation", "challenge_tournaments_undisputed_count", 
        "current_world_id", "clan_code", "clan_name", "role", "titan_cards", "boosted_cards"
    ]
    async with httpx.AsyncClient(timeout=15.0) as client:
        gh_res = await client.post("https://tt2-public.gamehivegames.com/api/player/data", json={"player_token": res.data[0]["player_api_token"], "properties": todas_propriedades}, headers={"API-Authenticate": GAMEHIVE_KEY, "Content-Type": "application/json"})
    return gh_res.json()

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)