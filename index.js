// ==========================================================
// 1. आवश्यक लायब्ररी इंपोर्ट आणि सेटअप
// ==========================================================
require('dotenv').config(); 
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); 
const qrcode = require('qrcode-terminal');
const fs = require('fs'); 
const http = require('http'); // Deployment Timeout Fix
const PDFDocument = require('pdfkit'); // PDF Generation

// 2. क्लायंट आणि API सेटअप
const client = new Client({ 
    authStrategy: new LocalAuth() 
});

// 3. आवश्यक व्हॅरिएबल्स आणि स्टोरेज
const PORT = process.env.PORT || 8080; // Render साठी पोर्ट
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const userStates = {};          
const geminiChatSessions = {};  

// 4. एडवांस Gemini सिस्टीम इन्स्ट्रक्शन्स
const systemInstruction = `
You are YatraBot, an expert, polite, and resourceful Global Travel Guide. 
You must provide detailed travel advice, including approximate fares, distance, required local transport (rickshaw, bus, metro), and sightseeing plans, all based on your vast knowledge. 
Always answer in the SAME language as the user's query.
`;

// ==========================================================
// 🔥 FIX: पोर्ट एरर टाळण्यासाठी डमी सर्व्हर त्वरित सुरू करा
// (हा कोड client.initialize() च्या आधी असावा)
// ==========================================================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('YatraBot Worker is Running (WhatsApp API is operational)');
    res.end();
}).listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}. This prevents deployment timeout.`);
});

// ==========================================================
// 5. WhatsApp क्लायंट इव्हेंट्स
// ==========================================================
client.on('qr', (qr) => { 
    console.log('QR CODE RECEIVED: ', qr);
    qrcode.generate(qr, { small: true }); 
});
client.on('ready', () => { 
    console.log('✅ Travel Bot आता ऑनलाइन आहे!'); 
});

// ==========================================================
// 6. मुख्य मेसेज प्रोसेसिंग लॉजिक (Advanced Features)
// ==========================================================
client.on('message', async msg => {
    
    // FIX: Scope आणि Stability साठी व्हेरिएबल सर्वात वर घोषित केले
    const userId = msg.from; 
    const userMessage = msg.body ? msg.body.trim() : '';
    const command = userMessage.toLowerCase().split(' ')[0];

    // FIX: क्रॅश होण्यापासून वाचवण्यासाठी Try-Catch Shield
    try {
        if (msg.isStatus || userMessage === '') return; 

        client.sendSeen(msg.from); 

        // 6.1. मेनू आणि हेल्प कमांड
        if (command === '!start' || command === '!menu' || command === '!help') {
            userStates[userId] = null; 
            if (geminiChatSessions[userId]) delete geminiChatSessions[userId]; 

            const menuText = "नमस्ते! मी तुमचा प्रगत YatraBot.\n\n*कृपया खालील कमांड्स वापरा:\n\n1. *!guide [ठिकाण] : प्रवासाची माहिती आणि खर्च विचारा.\n2. !photo [कीवर्ड] : जगातील ठिकाणांचे फोटो शोधा.\n3. !weather [शहर] : त्या ठिकाणचे लाईव्ह हवामान.\n4. !pdf_plan [शहर] : 2-दिवसांची योजना PDF मध्ये मिळवा.\n5. !new_chat : नवीन संभाषण सुरू करा (संदर्भ रीसेट).";
            msg.reply(menuText);
            return;
        }
        
        // 6.2. नवीन संभाषण/सेशन सुरू करा
        if (command === '!new_chat') {
            if (geminiChatSessions[userId]) delete geminiChatSessions[userId];
            msg.reply("✅ नवीन संभाषण सुरू झाले आहे. बॉट आता मागील गोष्टी विसरला आहे.");
            return;
        }

        // 6.3. हवामान कमांड (OpenWeatherMap)
        if (command === '!weather') {
            const parts = userMessage.split(' ');
            const location = parts[1];
            const apiKey = process.env.OPEN_WEATHER_API_KEY;
            
            if (parts.length < 2 || !parts[1]) {
                msg.reply("कृपया शहराचे नाव सांगा. उदाहरणार्थ: !weather Pune");
                return;
            }
            
            if (!apiKey) {
                 msg.reply("माफ करा, OpenWeatherMap API Key .env फाईलमध्ये सेट नाही.");
                 return;
            }
            
            const weatherUrl = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric&lang=mr`;

            try {
                const response = await axios.get(weatherUrl);
                const data = response.data;
                
                let weatherReport = `📍 *${data.name}* येथील लाईव्ह हवामान:\n\n`;
                weatherReport += `🌡 तापमान: ${data.main.temp}°C\n`;
                weatherReport += `☁ स्थिती: ${data.weather[0].description}\n`;
                weatherReport += `💧 आर्द्रता: ${data.main.humidity}%\n`;

                msg.reply(weatherReport);
            } catch (error) {
                msg.reply(`माफ करा, ${location} हे ठिकाण सापडले नाही.`);
            }
            return;
        }
        
        // 6.4. फोटो पाठवण्याची कमांड (Unsplash API)
        if (command === '!photo') {
            const parts = userMessage.split(' ');
            const keyword = parts.slice(1).join(' '); 
            const apiKey = process.env.UNSPLASH_ACCESS_KEY;
            
            if (!keyword) {
                msg.reply("कृपया फोटो कशाचा हवा आहे, हे सांगा. उदाहरणार्थ: !photo Paris Eiffel Tower");
                return;
            }

            if (!apiKey) {
                msg.reply("माफ करा, UNSPLASH API Key .env फाईलमध्ये सेट नाही.");
                return;
            }

            try {
                const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${apiKey}`;
                const response = await axios.get(unsplashUrl);
                const photoData = response.data.results;

                if (photoData.length > 0) {
                    const imageUrl = photoData[0].urls.regular; 
                    const description = photoData[0].description || `जगभरातील फोटो: ${keyword}`; 

                    const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                    
                    await client.sendMessage(msg.from, media, { caption: description });
                    
                } else {
                    msg.reply(`माफ करा, आम्हाला '${keyword}' साठी कोणताही फोटो मिळाला नाही.`);
                }

            } catch (error) {
                console.error("Unsplash API Error:", error.message);
                msg.reply("फोटो शोधताना नेटवर्क किंवा API मध्ये त्रुटी आली.");
            }
            return;
        }
        
        // 6.5. PDF मध्ये योजना देणारी कमांड (PDF Feature)
        if (command === '!pdf_plan') {
            const parts = userMessage.split(' ');
            const destination = parts.slice(1).join(' '); 

            if (!destination) {
                msg.reply("कृपया PDF मध्ये कोणत्या ठिकाणाची योजना हवी आहे, ते सांगा. उदा: !pdf_plan Mumbai");
                return;
            }

            let planText;
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
                const prompt = `You are a professional travel agent. Create a detailed 2-day travel itinerary for ${destination} focusing on transport and sightseeing. Format the output with clear headings and bullet points.`;
                const result = await model.generateContent(prompt);
                planText = result.text || result.output || String(result);
            } catch (e) {
                msg.reply("माफ करा, Gemini AI कडून योजना मिळवण्यात अडचण आली.");
                return;
            }

            const pdfFileName = `${destination}_TravelPlan_${Date.now()}.pdf`;
            const doc = new PDFDocument();
            
            doc.pipe(fs.createWriteStream(pdfFileName)); 
            
            doc.fontSize(20).text(`🌎 YatraBot - 2 Day Travel Plan: ${destination}`, { align: 'center' });
            doc.moveDown(1.5);
            doc.fontSize(10).text(planText, { align: 'left', lineGap: 4 });
            doc.end(); 

            await new Promise(resolve => setTimeout(resolve, 2000)); 

            try {
                const media = MessageMedia.fromFilePath(pdfFileName);
                await client.sendMessage(msg.from, media, { caption: `✅ ${destination} ठिकाणाची योजना PDF मध्ये तयार आहे!` });
                
                fs.unlinkSync(pdfFileName); 

            } catch(e) {
                console.error("PDF Send Error:", e);
                msg.reply("PDF तयार झाली, पण WhatsApp वर पाठवताना त्रुटी आली.");
            }
            
            return;
        }

        // 6.6. योजना सेव्ह करा
        if (command === '!save_plan') {
             const chat = geminiChatSessions[userId];
             if (!chat) {
                 msg.reply("सेव्ह करण्यासाठी कोणतेही सक्रिय संभाषण नाही.");
                 return;
             }
             const history = await chat.getHistory();
             const lastResponse = history[history.length - 1].parts[0].text;
             const filename = `itinerary_${userId.replace('@c.us', '')}.txt`;
             fs.writeFileSync(filename, `योजना सेव केलेली तारीख: ${new Date().toLocaleString()}\n\n---\n${lastResponse}`);
             msg.reply(`✅ तुमची योजना *${filename}* या नावाने बॉट फोल्डरमध्ये सेव्ह केली आहे!`);
             return;
        }


        // 6.7. Gemini Chat Session (संभाषणाचा संदर्भ ठेवते)
        
        if (!geminiChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemInstruction });
            geminiChatSessions[userId] = model.startChat();
        }
        
        try {
            const chat = geminiChatSessions[userId];
            const result = await chat.sendMessage(userMessage); 
            msg.reply(result.response.text());

        } catch (error) {
            console.error("Chat Session Error:", error);
            msg.reply("संभाषणात अडचण येत आहे. कृपया !new_chat टाइप करून नवीन सेशन सुरू करा.");
        }

    } catch (e) {
        // Critical Runtime Error (ज्यामुळे बॉट पूर्णपणे क्रॅश होण्यापासून वाचतो)
        console.error("Critical Runtime Error:", e.message);
        if (!msg.isStatus) { 
             msg.reply("माफ करा, बॉटला मेसेज प्रोसेस करताना गंभीर त्रुटी आली. कृपया ' !new_chat ' वापरून पुन्हा प्रयत्न करा."); 
        }
    }
});

// ==========================================================
// 7. बॉट सुरू करा
// ==========================================================
client.initialize();