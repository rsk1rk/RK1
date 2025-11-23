// ==========================================================
// YATRA BOT - FINAL PROFESSIONAL CONTEXTUAL VERSION
// Features: Detailed Step-by-Step Narrative + Tables + Links
// ==========================================================

require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); 
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const PDFDocument = require('pdfkit'); 
const express = require('express');

// --- 1. SERVER SETUP (Render Uptime) ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send("YatraBot Professional Contextual Mode Live!"));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- 2. CLIENT & AI SETUP ---
const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 
const geminiChatSessions = {};          

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ YatraBot Ready!'));

// --- 3. MAIN LOGIC ---
client.on('message', async msg => {
    
    const userId = msg.from; 
    const userMessage = msg.body ? msg.body.trim() : '';
    const command = userMessage.toLowerCase().split(' ')[0];

    try {
        if (msg.isStatus || userMessage === '') return; 

        // --- OLD COMMANDS (Weather, Photo, PDF) ---
        // (येथे जुने कमांड्सचे लॉजिक तसेच ठेवले आहे)
        if (command === '!weather') {
            const city = userMessage.split(' ')[1] || 'Pune';
            const apiKey = process.env.OPEN_WEATHER_API_KEY;
            try {
                const url = `http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
                const res = await axios.get(url);
                const d = res.data;
                msg.reply(`📍 *${d.name} Weather:*\n🌡 Temp: ${d.main.temp}°C\n☁ Condition: ${d.weather[0].description}`);
            } catch (e) { msg.reply("City not found or API Error."); }
            return;
        }

        if (command === '!photo') {
             const key = userMessage.replace('!photo', '').trim();
             if (!key) return msg.reply("What photo do you want? Ex: !photo Goa Beach");
             const apiKey = process.env.UNSPLASH_ACCESS_KEY;
             const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(key)}&per_page=1&client_id=${apiKey}`);
             if(res.data.results[0]) {
                 const media = await MessageMedia.fromUrl(res.data.results[0].urls.regular, {unsafeMime:true});
                 client.sendMessage(msg.from, media, {caption: key});
             } else { msg.reply("No photo found."); }
             return;
        }

        if (command === '!pdf_plan') {
            const dest = userMessage.replace('!pdf_plan', '').trim();
            if (!dest) { msg.reply("Destination? Ex: !pdf_plan Dubai"); return; }
            msg.reply("📄 Generating PDF Plan... Please wait.");
            
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
            const aiRes = await model.generateContent({ prompt: `Create a short 2-day itinerary for ${dest}.` });
            const text = aiRes.response && typeof aiRes.response.text === 'function' ? aiRes.response.text() : (aiRes.output_text || String(aiRes));

            const doc = new PDFDocument();
            const fileName = `Plan_${Date.now()}.pdf`;
            doc.pipe(fs.createWriteStream(fileName));
            doc.text(text);
            doc.end();

            setTimeout(async () => {
                const media = MessageMedia.fromFilePath(fileName);
                await client.sendMessage(msg.from, media, { caption: "✅ PDF Ready!" });
                fs.unlinkSync(fileName); 
            }, 3000);
            return;
        }

        if (command === '!reset' || command === '!new_chat') {
            delete geminiChatSessions[userId];
            msg.reply("🔄 Chat Reset! बोला, आज कुठे जायचे आहे?");
            return;
        }

        // --- NEW HYBRID TRAVEL LOGIC (ScreenShot Style) ---
        
        const today = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });

        // 🔥 हा प्रॉम्प्ट तुमच्या 'स्क्रीनशॉट' प्रमाणे सविस्तर माहिती देईल 🔥
        const smartSystemPrompt = `
        You are 'YatraBot', a highly experienced, professional, and friendly Travel Consultant.
        CURRENT DATE: ${today}.
        
        ### USER GOAL: Provide "Perfect Information" exactly like a human expert (Step-by-step narrative + structured data).

        ### MANDATORY OUTPUT STRUCTURE:
        1. *Start with a polite greeting and detailed contextual overview* (distance, complexity of the journey, best routes, etc. - just like the screenshots provided by the user).
        2. *Break the journey into logical 'Phases' or 'Steps'.* (e.g., Phase 1: Ratnagiri to Mumbai, Phase 2: Mumbai to Delhi).
        3. *For each Transport Mode (Bus/Train/Flight):*
           a. Provide a short, descriptive paragraph explaining the option.
           b. Include a structured Text Table for easy data comparison (Time, Price, Operator).
           c. Conclude the section with the appropriate Live Status Link.

        ### FINAL LINKS & DISCLAIMER:
        - *Bus Link:* 🎟 [Book Seats] (https://www.redbus.in/bus-tickets/search?fromCity=Source&toCity=Destination)
        - *Train Link:* 🔴 [Check Live Delay/Status] (https://www.google.com/search?q=live+train+status+${encodeURIComponent(userMessage)})
        - *Flight Link:* 💰 [View Prices] (https://www.google.com/search?q=flights+${encodeURIComponent(userMessage)})
        
        (Ensure the entire response is coherent and easy to read. Respond in the same language as the user query.)
        
        User Query: ${userMessage}
        `;

        if (!geminiChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            geminiChatSessions[userId] = model.startChat();
        }

        const chat = geminiChatSessions[userId];
        const result = await chat.sendMessage(smartSystemPrompt);
        await msg.reply(result.response.text());

    } catch (error) {
        console.error("Error:", error);
        msg.reply("⚠ Technical Error: " + error.message);
    }
});

client.initialize();