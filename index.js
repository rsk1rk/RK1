// ==========================================================
// 1. आवश्यक लायब्ररी इंपोर्ट आणि सेटअप (Advanced)
// ==========================================================
require('dotenv').config(); // FIX: .env फाईल लोड करण्यासाठी
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // MessageMedia जोडले
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); // Weather आणि Photo API साठी
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Itinerary saving साठी
// A. PDF तयार करण्यासाठी
const PDFDocument = require('pdfkit'); 
// B. फाईल सिस्टीम व्यवस्थापित करण्यासाठी (फाइल वाचणे/डिलीट करणे)
// C. MessageMedia आधीच import केलेले आहे.
// 2. क्लायंट आणि API सेटअप
// --- 24 तास चालू ठेवण्यासाठी डमी सर्व्हर (START) ---
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send("I am Alive! WhatsApp Bot is running.");
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});
// --- 24 तास चालू ठेवण्यासाठी डमी सर्व्हर (END) ---
const client = new Client({ 
    authStrategy: new LocalAuth() 
});

// FIX: API Key hardcode न करता .env मधून लोड करा
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 

// 3. स्टेट आणि संभाषण (Chat) स्टोरेज
const userStates = {};          
const geminiChatSessions = {};  

// 4. एडवांस Gemini सिस्टीम इन्स्ट्रक्शन्स (तुमच्या मागणीनुसार मल्टी-लँग्वेज)
const systemInstruction = `
You are YatraBot, an expert, polite, and resourceful Global Travel Guide.
User is asking for travel information.

Instructions:
1. Provide detailed travel information including Flights, Trains, and Buses options with estimated ticket prices.
2. If the user asks for a destination, suggest local transport like Rickshaw, Taxi, or Metro.
3. Give step-by-step navigation advice.
4. Suggest tourist places if asked.
5. *The response MUST be in the SAME language as the user's query.* For example, if the user asks in Marathi, answer in Marathi.
6. Keep the tone helpful and polite.
7. If the query is not about travel, politely decline in the user's query language.
`;

// 5. WhatsApp क्लायंट इव्हेंट्स
client.on('qr', (qr) => { 
    console.log('QR CODE RECEIVED: ', qr);
    qrcode.generate(qr, { small: true }); 
    console.log('हा QR कोड तुमच्या WhatsApp मधून Link Device वर जाऊन स्कॅन करा.');
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

        // UX सुधारणा: 'टायपिंग' स्टेटस फंक्शन काढले (Deprecation Fix)
        client.sendSeen(msg.from); 

        // 6.1. मेनू आणि हेल्प कमांड
        if (command === '!start' || command === '!menu' || command === '!help') {
            userStates[userId] = null; 
            if (geminiChatSessions[userId]) delete geminiChatSessions[userId]; 

            const menuText = "नमस्ते! मी तुमचा प्रगत YatraBot.\n\n*कृपया खालील कमांड्स वापरा:\n\n1. *!guide [ठिकाण] : प्रवासाची माहिती आणि खर्च विचारा.\n2. !photo [कीवर्ड] : जगातील ठिकाणांचे फोटो शोधा.\n3. !weather [शहर] : त्या ठिकाणचे लाईव्ह हवामान.\n4. !save_plan : बॉटचे मागील उत्तर एका फाईलमध्ये सेव्ह करा.\n5. !new_chat : नवीन संभाषण सुरू करा (संदर्भ रीसेट).";
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
            
            // 🔥 FIX: शहराचे नाव दिले आहे की नाही, हे तपासा
            if (parts.length < 2 || !parts[1]) {
                msg.reply("कृपया शहराचे नाव सांगा. उदाहरणार्थ: !weather Pune");
                return;
            }
            
            const location = parts[1];
            const apiKey = process.env.OPEN_WEATHER_API_KEY;
            
            if (!apiKey) {
                 msg.reply("माफ करा, OpenWeatherMap API Key .env फाईलमध्ये सेट नाही.");
                 return;
            }
            
            // FIX: URL मध्ये location ला encode केले आहे (उत्तम)
            const weatherUrl = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric&lang=mr`;

            try {
                const response = await axios.get(weatherUrl);
                const data = response.data;
                
                // FIX: weatherReport ला लेट ने घोषित करा (किंवा const/var) आणि सुरुवात करा
                let weatherReport = `📍 *${data.name}* येथील लाईव्ह हवामान:\n\n`;
                weatherReport += `🌡 तापमान: ${data.main.temp}°C\n`;
                weatherReport += `☁ स्थिती: ${data.weather[0].description}\n`;
                weatherReport += `💧 आर्द्रता: ${data.main.humidity}%\n`;

                msg.reply(weatherReport);
            } catch (error) {
                // HTTP 404 (Not Found) एररसाठी मेसेज
                msg.reply(`माफ करा, '${location}' हे ठिकाण सापडले नाही.`);
            }
            return;
        }
        
        // 6.4. फोटो पाठवण्याची कमांड (Unsplash API)
      // 6.4. फोटो पाठवण्याची कमांड (Unsplash API)
        if (command === '!photo') {
            const parts = userMessage.split(' ');
            const keyword = parts.slice(1).join(' '); 
            const apiKey = process.env.UNSPLASH_ACCESS_KEY;
            
            // 🔥 FIX: कीवर्ड रिकामा आहे की नाही, हे तपासा
            if (!keyword) {
                msg.reply("कृपया फोटो कशाचा हवा आहे, हे सांगा. उदाहरणार्थ: !photo Paris Eiffel Tower");
                return;
            }
            
            if (!apiKey) {
                msg.reply("माफ करा, UNSPLASH API Key .env फाईलमध्ये सेट नाही.");
                return;
            }

            try {
                // FIX: URL मध्ये keyword ला encode केले आहे (उत्तम)
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
// नवीन कमांड लॉजिक
if (command === '!pdf_plan') {
    const parts = userMessage.split(' ');
    const destination = parts.slice(1).join(' '); 

    if (!destination) {
        msg.reply("कृपया PDF मध्ये कोणत्या ठिकाणाची योजना हवी आहे, ते सांगा. उदा: !pdf_plan Goa");
        return;
    }

    // 1. Gemini कडून तपशीलवार योजना मिळवा (फक्त टेक्स्ट)
    let planText;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});
        const prompt = `You are a professional travel agent. Create a detailed 2-day travel itinerary for ${destination} focusing on transport and sightseeing. Format the output with clear headings and bullet points.`;
        const result = await model.generateContent(prompt);
        // result structure can vary depending on SDK; try common fields safely
        planText = result?.text || result?.output?.[0]?.content?.[0]?.text || JSON.stringify(result);
    } catch (e) {
        msg.reply("माफ करा, Gemini AI कडून योजना मिळवण्यात अडचण आली.");
        return;
    }

    // 2. PDF फाईल तयार करा आणि सेव्ह करा
    const pdfFileName = `${destination.replace(/\s+/g, '_')}_TravelPlan_${Date.now()}.pdf`;
    const doc = new PDFDocument();
    
    // फाईल सिस्टीममध्ये (Local Storage) फाईल लिहिणे सुरू करा
    doc.pipe(fs.createWriteStream(pdfFileName)); 
    
    // PDF मध्ये डेटा भरा
    doc.fontSize(20).text(`🌎 YatraBot - 2 Day Travel Plan: ${destination}`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(10).text(planText, { align: 'left', lineGap: 4 });
    doc.end(); // फाईल लिहायला पूर्ण करा

    // 3. WhatsApp वर PDF पाठवा
    
    // फाईल तयार होईपर्यंत थांबा (2 सेकंद)
    await new Promise(resolve => setTimeout(resolve, 2000)); 

    try {
        const media = MessageMedia.fromFilePath(pdfFileName);
        await client.sendMessage(msg.from, media, { caption: `✅ ${destination} ठिकाणाची योजना PDF मध्ये तयार आहे!` });
        
        // फाईल पाठवल्यानंतर लोकल सिस्टीममधून डिलीट करा (सिस्टम स्वच्छ ठेवण्यासाठी)
        fs.unlinkSync(pdfFileName); 

    } catch(e) {
        console.error("PDF Send Error:", e);
        msg.reply("PDF तयार झाली, पण WhatsApp वर पाठवताना त्रुटी आली.");
    }
    
    return;
}
        
        // 6.5. योजना सेव्ह करा
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

        // 6.6. Gemini Chat Session (संभाषणाचा संदर्भ ठेवते)
        
        if (!geminiChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemInstruction });
            geminiChatSessions[userId] = model.startChat();
        }
        
        try {
            const chat = geminiChatSessions[userId];
            // FIX: request is not iterable (sendMessage ला फक्त raw string हवा)
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

// बॉट सुरू करा
client.initialize();