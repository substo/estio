
import { GenericXmlParser } from '../lib/feed/parsers/generic-xml-parser';

async function run() {
    const parser = new GenericXmlParser();

    // Mock XML
    const xml = `
    <listings>
        <listing>
            <id>P123</id>
            <title>Beautiful Villa</title>
            <description>A nice place</description>
            <price>500000</price>
            <currency>EUR</currency>
            <images>
                <image>http://example.com/img1.jpg</image>
                <image>http://example.com/img2.jpg</image>
            </images>
            <city>Limassol</city>
        </listing>
        <property id="P124">
            <name>Apartment 5</name>
            <desc>Views of sea</desc>
            <amount>250000</amount>
            <images>
                <image url="http://example.com/img3.jpg" />
            </images>
        </property>
    </listings>
    `;

    console.log("Parsing mock XML...");
    const items = await parser.parse(xml);
    console.log("Parsed Items:", JSON.stringify(items, null, 2));

    if (items.length !== 2) {
        throw new Error("Expected 2 items");
    }

    if (items[0].title !== "Beautiful Villa") throw new Error("Item 1 title mismatch");
    if (items[1].title !== "Apartment 5") throw new Error("Item 2 title mismatch");
    console.log("Verification Passed!");
}

run().catch(console.error);
