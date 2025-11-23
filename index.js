// ==========================================================
// YATRA BOT - FINAL MERGED VERSION
// (Old Features: PDF, Weather, Photo) + (New Features: Smart Links, Timetable)
// ==========================================================

require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); // Weather आणि Photo साठी
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const PDFDocument = require('pdfkit'); 
const express = require('express');

// --- 1. SERVER SETUP (Render Uptime) ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send("YatraBot is Live with ALL Features!"));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- 2. SETUP CLIENT & AI ---
const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 
const geminiChatSessions = {};          

// --- 3. QR & READY EVENTS ---
client.on('qr', (qr) => { 
    qrcode.generate(qr, { small: true }); 
    console.log('QR Code generated. Scan it!');
});

client.on('ready', () => { 
    console.log('✅ YatraBot is Online with ALL features!'); 
});

// --- 4. MAIN MESSAGE LOGIC ---
client.on('message', async msg => {
    
    const userId = msg.from; 
    const userMessage = msg.body ? msg.body.trim() : '';
    const command = userMessage.toLowerCase().split(' ')[0];

    try {
        if (msg.isStatus || userMessage === '') return; 

        // ---------------------------------------------------------
        // PART A: तुमचे जुने फीचर्स (COMMANDS)
        // ---------------------------------------------------------

        // 1. Weather (हवामान)
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

        // 2. Photo (फोटो)
        if (command === '!photo') {
            const keyword = userMessage.replace('!photo', '').trim();
            const apiKey = process.env.UNSPLASH_ACCESS_KEY;
            if (!keyword) { msg.reply("कशाचा फोटो हवा आहे? उदा: !photo Eiffel Tower"); return; }
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

        // 3. PDF Plan (Trip PDF)
        if (command === '!pdf_plan') {
            const dest = userMessage.replace('!pdf_plan', '').trim();
            if (!dest) { msg.reply("ठिकाण सांगा. उदा: !pdf_plan Goa"); return; }
            
            msg.reply("📄 PDF तयार करत आहे, कृपया थांबा...");
            
            // AI कडून प्लॅन घेणे
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
            const result = await model.generateContent(`Create a 2-day itinerary for ${dest}. Keep it short.`);
            const planText = result.response.text();

            // PDF बनवणे
            const doc = new PDFDocument();
            const fileName = `Plan_${Date.now()}.pdf`;
            doc.pipe(fs.createWriteStream(fileName));
            doc.fontSize(18).text(`Travel Plan: ${dest}`, { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(planText);
            doc.end();

            // 2 सेकंद थांबून पाठवणे
            setTimeout(async () => {
                const media = MessageMedia.fromFilePath(fileName);
                await client.sendMessage(msg.from, media, { caption: "✅ तुमची ट्रिप प्लॅन PDF!" });
                fs.unlinkSync(fileName); // फाईल डिलीट करा
            }, 3000);
            return;
        }

        // 4. Reset / Help
        if (command === '!new_chat' || command === '!reset') {
            delete geminiChatSessions[userId];
            msg.reply("🔄 चॅट रिसेट झाले आहे. विचारा, तुम्हाला कुठे जायचे आहे?");
            return;
        }

        // ---------------------------------------------------------
        // PART B: नवीन स्मार्ट फिचर्स (GEMINI CHAT + LINKS)
        // ---------------------------------------------------------
        
        // 1. आजची तारीख (Real-time)
        const today = new Date().toLocaleString("en-IN", { 
            timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" 
        });

        // 2. स्मार्ट प्रॉम्प्ट (Sandwich Method)
        // यात "जुना स्वभाव" (YatraBot) आणि "नवीन लिंक्स" (RedBus/Google) दोन्ही आहेत.
        const smartSystemPrompt = `
        You are 'YatraBot', an advanced Travel Assistant.
        CURRENT DATE IN INDIA: ${today}.
        
        YOUR TASK: Help user with travel plans, standard timetables, and generation of LIVE LINKS.

        ### RULES (NO API MODE):
        
        1. *🚌 BUSES:*
           - Suggest operators (MSRTC, Neeta, etc.) and general frequency.
           - *ALWAYS* give this RedBus Link:
             "🚌 Check Live Seats: [View on RedBus](https://www.redbus.in/bus-tickets/search?fromCity=Source&toCity=Destination)"
             (Try to replace Source/Destination in link if specific cities mentioned)

        2. *🚂 TRAINS:*
           - Provide standard train names/times from your database.
           - *ALWAYS* give this Google Link for Live Status:
             "🚂 Track Live Status: [Click Here](https://www.google.com/search?q=train+status+${encodeURIComponent(userMessage)})"

        3. *✈ FLIGHTS:*
           - Suggest airlines.
           - *ALWAYS* give Google Flights Link:
             "✈ Check Prices: [View Flights](https://www.google.com/search?q=flights+${encodeURIComponent(userMessage)})"

        4. *GENERAL:*
           - If user talks casually (Hi, Hello), be polite.
           - Answer in the language user asked (Marathi/English).
        
        User Query: ${userMessage}
        `;

        // 3. चॅट सेशन हँडलिंग
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
        // आता बॉट एरर लपवणार नाही, तुम्हाला सांगेल
        msg.reply("⚠ Technical Error: " + error.message);
    }
});

client.initialize();