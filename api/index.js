const express = require('express');
const db = require('../db');
const app = express();

app.use(express.json());

// Jalur tes dasar
app.get('/api', (req, res) => {
  res.json({ 
    message: "Halo! Express berjalan sukses menggunakan Node.js." 
  });
});

// ========================================================
// GET LIST PENDAFTAR ANTREAN
// Parameter Query Opsional: ?date=YYYY-MM-DD
// ========================================================
app.get('/api/queue/list', async (req, res) => {
    // 1. Ambil parameter tanggal dari query string (jika ada)
    const { date } = req.query;

    let targetDate;

    // 2. Jika parameter 'date' tidak diisi, otomatis gunakan tanggal hari ini
    if (!date) {
        targetDate = new Date().toISOString().split('T')[0]; // Hasil: "2026-05-19"
    } else {
        // Validasi format tanggal sederhana (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Format parameter tanggal salah. Gunakan format YYYY-MM-DD.' 
            });
        }
        targetDate = date;
    }

    try {
        // 3. Query ke TiDB Cloud. Diurutkan berdasarkan waktu daftar (created_at) paling awal
        const query = `
            SELECT 
                id, 
                queue_date, 
                queue_number, 
                queue_code, 
                sequence_order, 
                customer_name, 
                address, 
                whatsapp_number, 
                email, 
                status, 
                created_at 
            FROM queues 
            WHERE queue_date = ? 
            ORDER BY created_at ASC
        `;

        const [rows] = await db.query(query, [targetDate]);

        // 4. Kirim respons balik ke client
        res.json({
            status: 'success',
            meta: {
                total_data: rows.length,
                filtered_date: targetDate
            },
            data: rows
        });

    } catch (error) {
        res.status(500).json({ 
            status: 'error',
            message: 'Gagal mengambil data pendaftar antrean.',
            error: error.message 
        });
    }
});



// Jika dijalankan di lokal (bukan di Vercel), server butuh app.listen
if (process.env.NODE_ENV !== 'production') {
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`Server lokal berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;