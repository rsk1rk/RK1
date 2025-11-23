// ==========================================================
// YATRA BOT - FINAL MASTER MIXED VERSION
// Features included:
// 1. Detailed Travel Info (Text + Tables + Links)
// 2. Weather (!weather)
// 3. Photos (!photo)
// 4. PDF Plans (!pdf_plan)
// ==========================================================

require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); // Weather & Photos साठी
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const PDFDocument = require('pdfkit'); 
const express = require('express');

// --- 1. SERVER SETUP (For 24/7 Uptime) ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send("YatraBot Master Version is Live!"));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- 2. CLIENT & AI SETUP ---
const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 
const geminiChatSessions = {};          

// --- 3. BASIC EVENTS ---
client.on('qr', (qr) => { 
    qrcode.generate(qr, { small: true }); 
    console.log('QR Code generated. Scan it!');
});

client.on('ready', () => { 
    console.log('✅ YatraBot is Online with ALL Features!'); 
});

// --- 4. MAIN MESSAGE LOGIC ---
client.on('message', async msg => {
    
    const userId = msg.from; 
    const userMessage = msg.body ? msg.body.trim() : '';
    const command = userMessage.toLowerCase().split(' ')[0];

    try {
        if (msg.isStatus || userMessage === '') return; 

        // =========================================================
        // PART A: OLD FEATURES (जुने फीचर्स)
        // =========================================================

        // 1. Weather (हवामान)
        if (command === '!weather') {
            const city = userMessage.split(' ')[1];
            if (!city) { msg.reply("Please mention city name. Ex: !weather Pune"); return; }
            const apiKey = process.env.OPEN_WEATHER_API_KEY;
            try {
                const url = `http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
                const res = await axios.get(url);
                const d = res.data;
                msg.reply(`📍 *${d.name} Weather:*\n🌡 Temp: ${d.main.temp}°C\n☁ Condition: ${d.weather[0].description}\n💨 Wind: ${d.wind.speed} m/s`);
            } catch (e) { msg.reply("City not found or API Error."); }
            return;
        }

        // 2. Photos (फोटो)
        if (command === '!photo') {
            const key = userMessage.replace('!photo', '').trim();
            if (!key) { msg.reply("What photo do you want? Ex: !photo Goa Beach"); return; }
            const apiKey = process.env.UNSPLASH_ACCESS_KEY;
            try {
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(key)}&per_page=1&client_id=${apiKey}`;
                const res = await axios.get(url);
                if (res.data.results.length > 0) {
                    const imgUrl = res.data.results[0].urls.regular;
                    const media = await MessageMedia.fromUrl(imgUrl, { unsafeMime: true });
                    await client.sendMessage(msg.from, media, { caption: `📸 Here is a photo of ${key}` });
                } else { msg.reply("No photo found."); }
            } catch (e) { msg.reply("Error fetching photo."); }
            return;
        }

        // 3. PDF Plan (ट्रिप प्लॅन PDF)
        if (command === '!pdf_plan') {
            const dest = userMessage.replace('!pdf_plan', '').trim();
            if (!dest) { msg.reply("Destination? Ex: !pdf_plan Dubai"); return; }
            msg.reply("📄 Generating PDF Plan... Please wait.");
            
            // Get Plan from AI
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
            const aiRes = await model.generateContent(`Create a short 2-day itinerary for ${dest}.`);
            const text = aiRes.response.text();

            // Create PDF
            const doc = new PDFDocument();
            const fileName = `Plan_${Date.now()}.pdf`;
            doc.pipe(fs.createWriteStream(fileName));
            doc.fontSize(20).text(`Trip to ${dest}`, { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(text);
            doc.end();

            // Send PDF
            setTimeout(async () => {
                const media = MessageMedia.fromFilePath(fileName);
                await client.sendMessage(msg.from, media, { caption: "✅ Your Travel Plan PDF" });
                fs.unlinkSync(fileName); // Clean up
            }, 3000);
            return;
        }

        // 4. Reset (!new_chat)
        if (command === '!reset' || command === '!new_chat') {
            delete geminiChatSessions[userId];
            msg.reply("🔄 Chat Reset! नमस्कार, मी तुमचा YatraBot. सांगा आज कुठे जायचे आहे?");
            return;
        }

        // =========================================================
        // PART B: NEW HYBRID TRAVEL FEATURES (नवीन मिक्स फीचर्स)
        // (Detailed Info + Tables + Smart Links)
        // =========================================================
        
        // आजची तारीख
        const today = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });

        // 🔥 हा प्रॉम्प्ट तुमच्या 'स्क्रीनशॉट' सारखा हुशार आहे 🔥
        const smartSystemPrompt = `
        You are 'YatraBot', an Expert Travel Consultant.
        CURRENT DATE: ${today}.
        
        USER QUERY: "${userMessage}"
        
        ### INSTRUCTIONS:
        The user wants a "Consultant-like" experience. 
        1. First, explain the route nicely (Distance, Best mode).
        2. Then, provide structured TABLES for Buses/Trains.
        3. Finally, give Google/RedBus LINKS for Live Status.

        ### FORMAT YOUR RESPONSE LIKE THIS:

        *👋 Introduction:*
        (Explain the route, distance, and best options like a human expert. E.g., "Nashik to Goa is a long journey...")

        *🚌 By Bus:*
        (Explain operators and comfort).
        | Operator | Time | Approx Price |
        |---|---|---|
        | (Name) | (Time) | (Price) |
        
        🎟 Book Seats: [View on RedBus](https://www.redbus.in/bus-tickets/search?fromCity=Source&toCity=Destination)

        *🚂 By Train:*
        (Explain train availability, e.g., "Direct trains are limited...").
        | Train Name | Dep | Arr |
        |---|---|---|
        | (Name) | (Time) | (Time) |
        
        ⚠ Check Live Status: 🔴 [Track Train Here](https://www.google.com/search?q=live+train+status+${encodeURIComponent(userMessage)})

        *✈ By Flight:*
        (Explain airports).
        💰 Check Prices: 👉 [Google Flights](https://www.google.com/search?q=flights+${encodeURIComponent(userMessage)})

        (Answer in the language user used: Marathi/English).
        `;

        // AI Chat Handling
        if (!geminiChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            geminiChatSessions[userId] = model.startChat();
        }

        const chat = geminiChatSessions[userId];
        const result = await chat.sendMessage(smartSystemPrompt);
        const response = result.response.text();

        // Send Final Reply
        await msg.reply(response);

    } catch (error) {
        console.error("Error:", error);
        msg.reply("⚠ Technical Error: " + error.message);
    }
});

client.initialize();