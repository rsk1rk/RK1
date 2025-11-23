// ==========================================================
// YATRA BOT - FINAL SUPER VERSION
// Features: PDF, Weather, Photos + Smart Tables + Delay Links
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
app.get('/', (req, res) => res.send("YatraBot is Live with Smart Tables!"));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- 2. SETUP CLIENT & AI ---
const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 
const geminiChatSessions = {};          

// --- 3. EVENTS ---
client.on('qr', (qr) => { 
    qrcode.generate(qr, { small: true }); 
    console.log('QR Code generated. Scan it!');
});

client.on('ready', () => { 
    console.log('✅ YatraBot is Online!'); 
});

// --- 4. MAIN LOGIC ---
client.on('message', async msg => {
    
    const userId = msg.from; 
    const userMessage = msg.body ? msg.body.trim() : '';
    const command = userMessage.toLowerCase().split(' ')[0];

    try {
        if (msg.isStatus || userMessage === '') return; 

        // --- PART A: जुने फीचर्स (COMMANDS) ---

        // 1. Weather
        if (command === '!weather') {
            const parts = userMessage.split(' ');
            if (parts.length < 2) { msg.reply("शहराचे नाव सांगा. उदा: !weather Pune"); return; }
            const city = parts[1];
            const apiKey = process.env.OPEN_WEATHER_API_KEY;
            try {
                const url = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=mr`;
                const res = await axios.get(url);
                const data = res.data;
                msg.reply(`📍 *${data.name}* हवामान:\n🌡 तापमान: ${data.main.temp}°C\n☁ स्थिती: ${data.weather[0].description}`);
            } catch (e) { msg.reply("शहर सापडले नाही."); }
            return;
        }

        // 2. Photo
        if (command === '!photo') {
            const keyword = userMessage.replace('!photo', '').trim();
            const apiKey = process.env.UNSPLASH_ACCESS_KEY;
            if (!keyword) { msg.reply("कशाचा फोटो हवा आहे? उदा: !photo Taj Mahal"); return; }
            try {
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${apiKey}`;
                const res = await axios.get(url);
                if (res.data.results.length > 0) {
                    const imgUrl = res.data.results[0].urls.regular;
                    const media = await MessageMedia.fromUrl(imgUrl, { unsafeMime: true });
                    await client.sendMessage(msg.from, media, { caption: `📸 ${keyword}` });
                } else { msg.reply("फोटो मिळाला नाही."); }
            } catch (e) { msg.reply("फोटो शोधताना एरर आला."); }
            return;
        }

        // 3. PDF Plan
        if (command === '!pdf_plan') {
            const dest = userMessage.replace('!pdf_plan', '').trim();
            if (!dest) { msg.reply("ठिकाण सांगा. उदा: !pdf_plan Goa"); return; }
            msg.reply("📄 PDF तयार करत आहे...");
            
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
            const result = await model.generateContent(`Create a 2-day itinerary for ${dest}. Keep it short.`);
            const planText = result.response.text();

            const doc = new PDFDocument();
            const fileName = `Plan_${Date.now()}.pdf`;
            doc.pipe(fs.createWriteStream(fileName));
            doc.fontSize(18).text(`Travel Plan: ${dest}`, { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(planText);
            doc.end();

            setTimeout(async () => {
                const media = MessageMedia.fromFilePath(fileName);
                await client.sendMessage(msg.from, media, { caption: "✅ तुमची ट्रिप प्लॅन PDF!" });
                fs.unlinkSync(fileName);
            }, 3000);
            return;
        }

        if (command === '!reset' || command === '!new_chat') {
            delete geminiChatSessions[userId];
            msg.reply("🔄 चॅट रिसेट झाले आहे.");
            return;
        }

        // --- PART B: नवीन हायब्रीड फीचर्स (CHAT + TABLES + LINKS) ---
        
        // आजची तारीख
        const today = new Date().toLocaleString("en-IN", { 
            timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" 
        });

        // 🔥 हा आहे तुमचा "जुगाड" प्रॉम्प्ट (Table + Link)
        const smartSystemPrompt = `
        You are 'YatraBot', a Smart Travel Assistant.
        CURRENT DATE IN INDIA: ${today}.
        
        INSTRUCTIONS:
        User wants detailed info INSIDE the chat, with a Live Status link ONLY at the end.

        1. *🚂 FOR TRAINS:*
           - First, list trains with Standard Timings in a list/table format.
           - Format:
             "🚂 Train Schedule (Standard)
             --------------------------------
             1. Train Name (Number)
                🕒 Dep: HH:MM AM | Arr: HH:MM PM
                🎫 Days: Daily / Mon, Tue..
             --------------------------------"
           - *AT THE END (Mandatory):*
             "⚠ Note: ट्रेन लेट किंवा कॅन्सल आहे का, हे पाहण्यासाठी खाली क्लिक करा:
             🔴 [Check Live Delay/Status](https://www.google.com/search?q=live+train+status+${encodeURIComponent(userMessage)})"

        2. *🚌 FOR BUSES:*
           - Show a Text Table for options.
           - Format:
             "🚌 Bus Options (Approx)
             --------------------------------
             | Operator | Time | Est. Price |
             |----------|------|------------|
             | MSRTC    | 06:00| ₹350+      |
             | Neeta    | 08:30| ₹600+      |
             --------------------------------
             Frequency: Every 30-60 mins."
           - *AT THE END:*
             "🎟 Book Seats: [View on RedBus](https://www.redbus.in/bus-tickets/search?fromCity=Source&toCity=Destination)"

        3. *✈ FOR FLIGHTS:*
           - List Airlines & Estimated Price.
           - *AT THE END:* "💰 Real-Time Price: [Google Flights](https://www.google.com/search?q=flights+${encodeURIComponent(userMessage)})"

        4. *General:* Polite and helpful in User's Language.
        
        User Query: ${userMessage}
        `;

        if (!geminiChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            geminiChatSessions[userId] = model.startChat();
        }

        const chat = geminiChatSessions[userId];
        const result = await chat.sendMessage(smartSystemPrompt);
        const response = result.response.text();

        await msg.reply(response);

    } catch (error) {
        console.error("Error:", error);
        msg.reply("⚠ Technical Error: " + error.message);
    }
});

client.initialize();