import asyncio
import os
import subprocess
from pathlib import Path
from edge_tts import Communicate

# Configuration
CATEGORIES = {
    "comandos_curtos": [
        "Lights on.", "Lights off.", "Temperature 22 degrees.", "Lock doors.",
        "Open windows.", "Check battery.", "Silence alarms.", "Night mode.",
        "Turn on coffee maker.", "System status.", "Stop music.", "Maximum volume.",
        "Restart router.", "Clear console.", "Activate shield.", "Deactivate lasers.",
        "Total focus.", "Power saving mode.", "Weather in London?", "Current time?",
        "Schedule meeting.", "Cancel flight.", "Turn on projector.", "Lower blinds.",
        "Raise blinds.", "Main menu.", "Help Rocky.", "Exit system.",
        "Enter orbit.", "Protocol Alpha."
    ],
    "questoes_complexas": [
        "Rocky, can you analyze the system log and tell me if there were latency spikes in the last hour?",
        "What is the probability of survival if oxygen drops another five percent in the next ten minutes?",
        "Can you calculate the return trajectory considering Jupiter's gravity and current fuel?",
        "Explain to me in detail how this ship's ion propulsion engine works.",
        "Rocky, summarize the last communications received from ground base since eight in the morning.",
        "Is there any correlation between core temperature and observed failures in the navigation system?",
        "What are the viable alternatives if the main generator fails during the landing phase?",
        "Can you compare current solar panel performance with the historical average for this month?",
        "Rocky, identify all corrupted files in the system directory and try to recover them automatically.",
        "How is cosmic radiation affecting the external sensors in this space quadrant?",
        "Give me a list of all consumables that will be below critical level in the next forty-eight hours.",
        "Rocky, analyze the light spectrum of the nearby star and identify its primary chemical composition.",
        "Can you reconfigure the sensor network to prioritize micrometeorite detection on the left side of the ship?",
        "What would be the impact of increasing engine power by twenty percent during the next maneuver?",
        "Rocky, translate the last transmission received and analyze the emotional tone of the message.",
        "Can you create a trend chart for the power consumption of all critical subsystems?",
        "Explain the difference between level one and level four security protocols in case of decompression.",
        "Rocky, check if there are pending firmware updates for the external robotic arm.",
        "What is the exact distance to the next refueling point considering our cruise speed?",
        "Can you simulate a solar storm scenario and suggest the best protection measures?",
        "Rocky, help me debug this script that's causing a segmentation fault in the AI module.",
        "What are the safest stellar coordinates to avoid the asteroid field ahead of us?",
        "Can you monitor the crew's vital signs and alert me if there are signs of extreme fatigue?",
        "Explain how the water recycling system manages to maintain the purity required for human consumption.",
        "Rocky, what is the current status of the terraforming project in Mars sector three?",
        "Can you analyze fluctuations in the magnetic field and predict the next polarity reversal?",
        "How can we optimize RAM usage to support the new version of the operating system?",
        "Rocky, search the historical database for incidents similar to this one we are experiencing.",
        "Can you suggest a preventive maintenance plan for the lateral maneuver thrusters?",
        "What is the estimated time of arrival if we maintain this constant acceleration until the destination?"
    ],
    "disfluencias_ruido": [
        "Um... Rocky... let me see... ah, activate the... security protocol.",
        "Uh... can you... like... check if... um... the lights are off?",
        "Rocky... ah... what is the... um... temperature... wait... outdoor temperature?",
        "So... Rocky... listen... ah... can you open the door... but slowly.",
        "Well... um... Rocky... maybe... ah... you need to restart the... the... system.",
        "Ah... um... let me think... Rocky... can you... uh... play music?",
        "Rocky... um... help me with... ah... this... how do you say... the inventory.",
        "Uh... Rocky... ah... um... see if... like... there is anyone outside.",
        "Um... ah... Rocky... maybe... uh... you should... um... lock everything.",
        "Rocky... ah... uh... I wonder... um... can you... ah... give me the coordinates?",
        "Um... let's see... ah... Rocky... uh... activate silence mode.",
        "Uh... Rocky... um... ah... can you... like... delete the log... now.",
        "Ah... um... Rocky... uh... what is... ah... happening with the engine?",
        "Um... Rocky... ah... uh... can you... um... increase brightness... please.",
        "Uh... Rocky... um... ah... where is... like... the manual?",
        "Ah... um... let me see... Rocky... uh... can you... ah... call the base?",
        "Um... Rocky... ah... uh... check... um... if the oxygen is... ah... okay.",
        "Uh... Rocky... um... ah... can you... like... read the... um... report?",
        "Ah... um... Rocky... uh... what... ah... happened yesterday?",
        "Um... Rocky... ah... uh... can you... um... close the... ah... window?"
    ],
    "hail_mary": [
        "Amaze, amaze, amaze!", "Fist my bump!", "Question?",
        "You are scary space monster. I am scary space monster.",
        "I watch you while you sleep.", "Jazz hands!",
        "Grace, what is the status of the Taumoeba?",
        "Eridian technology is very efficient.",
        "Rocky, why are you leak-poking?",
        "I have been awake for many blips.",
        "Human memory is bad. Eridian memory is good.",
        "We are friends, question?",
        "The Hail Mary is a good ship.",
        "Astrophage is amazing fuel.",
        "You sleep, I watch.",
        "Heavy gravity is bad for bones.",
        "Your atmosphere is poison to me.",
        "Science is the answer, always.",
        "We save the world together.",
        "Project Hail Mary is a success."
    ]
}

VOICES = ["en-US-GuyNeural", "en-US-AvaNeural"]
SPEEDS = ["-10%", "+0%", "+10%"]
BASE_DIR = Path("tests/assets/massive_set")

async def generate_audio(text, voice, rate, output_path, retries=3):
    for attempt in range(retries):
        try:
            communicate = Communicate(text, voice, rate=rate)
            temp_mp3 = output_path.with_suffix(".mp3")
            await communicate.save(temp_mp3)
            
            # Convert to 16kHz Mono WAV using ffmpeg directly
            cmd = [
                "ffmpeg", "-y", "-i", str(temp_mp3),
                "-ar", "16000", "-ac", "1", str(output_path)
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Cleanup temp MP3
            if temp_mp3.exists():
                os.remove(temp_mp3)
            return True
        except Exception as e:
            print(f"  Error generating {output_path.name} (Attempt {attempt+1}/{retries}): {e}")
            if attempt < retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
            else:
                return False

async def main():
    print(f"Starting massive test set generation in {BASE_DIR} (English Only)...")
    
    # We don't shutil.rmtree here anymore so we can resume if needed
    if not BASE_DIR.exists():
        BASE_DIR.mkdir(parents=True)
        
    count = 0
    generated = 0
    
    for category, phrases in CATEGORIES.items():
        cat_dir = BASE_DIR / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        
        for i, phrase in enumerate(phrases):
            # Rotate voice and speed to ensure variety
            voice = VOICES[i % len(VOICES)]
            speed = SPEEDS[i % len(SPEEDS)]
            
            # Use short ID for filename
            file_id = f"{i:03d}"
            filename = f"{voice}_{speed.replace('%', 'pct').replace('+', 'p').replace('-', 'm')}_{file_id}.wav"
            output_path = cat_dir / filename
            
            if output_path.exists():
                # print(f"  Skipping {filename} (already exists)")
                count += 1
                continue
            
            print(f"[{count+1}] Generating: {filename} ({category})")
            success = await generate_audio(phrase, voice, speed, output_path)
            if success:
                generated += 1
            count += 1

    print(f"\nDone! Total files in set: {count}. Newly generated: {generated}.")

if __name__ == "__main__":
    asyncio.run(main())
