import dotenv from "dotenv";
dotenv.config({ path: ".env.prod" });
import { subscribeWhatsAppAppToWaba } from "../lib/whatsapp/client";

// Mock the getWhatsAppCloudCredentials because it needs db
const wabaId = "1240333231293494";
const token = "EAAczyMojzxQBRczz7ZBv7EpDTdGp3NKKh3Q76ncpORLEtGko0IBszRyIBJI9yru5sJNCK1LxWDD4ahHUcOeWD0AgwhWYIm4BGhZAwoeIZBKt4ZC8xuZADo0Qbud4c2ZCEHm0l47K0lLtT2WnooEREKm2052qinXUckkILyZA2usgWcuZBFZBwAojE2RZCr5h8XBQZDZD";

async function run() {
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ subscribed_fields: ["messages"] })
        });
        const data = await res.text();
        console.log("Status:", res.status);
        console.log("Response:", data);
    } catch(e) {
        console.error(e);
    }
}
run();
