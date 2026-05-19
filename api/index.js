const express = require('express');
const app = express();

app.use(express.json());

// Jalur tes dasar
app.get('/api', (req, res) => {
  res.json({ 
    message: "Halo! Express berjalan sukses menggunakan Node.js." 
  });
});

app.get('/api/duwa', (req, res) => {
  res.json({ 
    message: "Halo! Duwa" 
  });
});

// Jalur contoh untuk database Anda nanti
app.get('/api/users', (req, res) => {
  res.json({ message: "Endpoint ini siap dihubungkan ke TiDB Cloud!" });
});

// Jika dijalankan di lokal (bukan di Vercel), server butuh app.listen
if (process.env.NODE_ENV !== 'production') {
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`Server lokal berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;