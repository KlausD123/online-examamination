const mysql = require('mysql2/promise');
module.exports = mysql.createPool(process.env.DATABASE_URL);