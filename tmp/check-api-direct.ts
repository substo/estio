import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
    const token = "EAAczyMojzxQBRczz7ZBv7EpDTdGp3NKKh3Q76ncpORLEtGko0IBszRyIBJI9yru5sJNCK1LxWDD4ahHUcOeWD0AgwhWYIm4BGhZAwoeIZBKt4ZC8xuZADo0Qbud4c2ZCEHm0l47K0lLtT2WnooEREKm2052qinXUckkILyZA2usgWcuZBFZBwAojE2RZCr5h8XBQZDZD";
    const wabaId = "1240333231293494";

    console.log("Making direct request to Meta Graph API...");
    const url = `https://graph.facebook.com/v21.0/${wabaId}?fields=id,name`;
    const res = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    const body = await res.text();
    console.log("Status:", res.status);
    console.log("Body:", body);
}

run().catch(console.error);
