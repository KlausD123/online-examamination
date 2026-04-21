const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function initDB() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
        multipleStatements: true
    });

    const sql = fs.readFileSync('./database.sql', 'utf8');

    await connection.query(sql);

    console.log("✅ Database initialized automatically");
    await connection.end();
}

initDB();