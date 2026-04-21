const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function initDB() {
    try {
        const connection = await mysql.createConnection(process.env.DATABASE_URL);

        const sql = fs.readFileSync('./database.sql', 'utf8');

        await connection.query(sql);

        console.log("✅ Database initialized automatically");
        await connection.end();

    } catch (err) {
        console.error("❌ DB Init Error:", err.message);
        process.exit(1);
    }
}

module.exports = initDB;