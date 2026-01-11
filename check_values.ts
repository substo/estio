
import db from "./lib/db";

async function checkValues() {
    const conditions = await db.property.findMany({
        select: { condition: true },
        distinct: ['condition'],
        where: { publicationStatus: 'PUBLISHED' }
    });

    const types = await db.property.findMany({
        select: { type: true },
        distinct: ['type'],
        where: { publicationStatus: 'PUBLISHED' }
    });

    console.log("Conditions:", conditions.map(c => c.condition));
    console.log("Types:", types.map(t => t.type));
}

checkValues();
