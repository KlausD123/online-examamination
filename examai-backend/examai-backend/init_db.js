const fs = require('fs');
const mysql = require('mysql2/promise');

module.exports = async function initDB() {
    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    const sql = fs.readFileSync('./database.sql', 'utf8');
    await connection.query(sql);
    console.log("✅ Database initialized");
    await connection.end();
};