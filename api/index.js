const express = require("express");
const db = require("../db");
const { fakerID_ID: faker } = require("@faker-js/faker");

const app = express();
app.use(express.json());

// Jalur tes dasar
app.get("/api", (req, res) => {
  res.json({
    message: "Halo! Express berjalan sukses!!!",
  });
});

const getTodayDate = () => new Date().toISOString().split("T")[0];

// ========================================================
// GET LIST PENDAFTAR ANTREAN
// Parameter Query Opsional: ?date=YYYY-MM-DD
// - Jika parameter 'date' tidak diisi, otomatis gunakan tanggal hari ini
// ========================================================
app.get("/api/queue/list", async (req, res) => {
  // 1. Ambil parameter tanggal dari query string (jika ada)
  const { date } = req.query;

  let targetDate;

  // 2. Jika parameter 'date' tidak diisi, otomatis gunakan tanggal hari ini
  if (!date) {
    targetDate = getTodayDate(); // Hasil: "2026-05-19"
  } else {
    // Validasi format tanggal sederhana (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        status: "error",
        message: "Format parameter tanggal salah. Gunakan format YYYY-MM-DD.",
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
      status: "success",
      meta: {
        total_data: rows.length,
        filtered_date: targetDate,
      },
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Gagal mengambil data pendaftar antrean.",
      error: error.message,
    });
  }
});

// ========================================================
// SERVICE PENCARIAN ANTREAN MULTI-KOLOM
// Query Parameter: ?keyword=Budi&date=2026-05-20
// ========================================================
app.get('/api/queue/search', async (req, res) => {
    // 1. Ambil parameter dari query string URL
    const { keyword, date } = req.query;

    // Validasi: Keyword wajib diisi
    if (!keyword) {
        return res.status(400).json({
            status: 'error',
            message: 'Parameter keyword pencarian wajib diisi.'
        });
    }

    try {
        // 2. Format kata kunci agar mendukung pencarian parsial (LIKE %keyword%)
        const searchPattern = `%${keyword}%`;
        
        // Buat query dasar (Base Query)
        let query = `
            SELECT * FROM queues 
            WHERE (
                customer_name LIKE ? 
                OR whatsapp_number LIKE ? 
                OR email LIKE ? 
                OR queue_code LIKE ?
            )
        `;
        
        // Array untuk menampung parameter query SQL
        const queryParams = [searchPattern, searchPattern, searchPattern, searchPattern];

        // 3. JIKA PARAMETER TANGGAL DISERTAKAN: Tambahkan kondisi WHERE secara dinamis
        if (date) {
            // Validasi format tanggal sederhana (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(date)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Format parameter date salah. Gunakan format YYYY-MM-DD.'
                });
            }
            
            // Tambahkan filter tanggal ke dalam query string dan parameter
            query += ` AND queue_date = ?`;
            queryParams.push(date);
        }

        // Urutkan berdasarkan tanggal dan nomor antrean agar rapi
        query += ` ORDER BY queue_date DESC, queue_number ASC`;

        // 4. Eksekusi Query ke TiDB Cloud
        const [rows] = await db.query(query, queryParams);

        res.json({
            status: 'success',
            meta: {
                keyword_searched: keyword,
                date_filter: date || 'all_days',
                total_found: rows.length
            },
            data: rows
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Gagal melakukan pencarian data antrean.',
            error: error.message
        });
    }
});

// ========================================================
// SERVICE GET DATA BERDASARKAN STATUS DAN TANGGAL
// Query Parameter: ?status=waiting&date=2026-05-20
// ========================================================
app.get('/api/queue/by-status', async (req, res) => {
    // 1. Ambil parameter dari query string
    const { status, date } = req.query;

    // VALIDASI WAJIB: Parameter status tidak boleh kosong
    if (!status) {
        return res.status(400).json({
            status: 'error',
            message: 'Parameter status wajib disertakan (e.g. ?status=waiting).'
        });
    }

    // Validasi variasi status sesuai ketentuan enum database
    const allowedStatus = ['registered', 'reconfirm', 'waiting', 'serving', 'skipped', 'cancelled', 'completed'];
    if (!allowedStatus.includes(status)) {
        return res.status(400).json({
            status: 'error',
            message: `Status '${status}' tidak valid. Opsi yang diperbolehkan: ${allowedStatus.join(', ')}`
        });
    }

    // 2. Jika parameter tanggal tidak diisi, otomatis gunakan tanggal hari ini (getTodayDate)
    const targetDate = date ? date : getTodayDate();

    // Validasi format tanggal sederhana jika diinput manual oleh user
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (date && !dateRegex.test(date)) {
        return res.status(400).json({
            status: 'error',
            message: 'Format parameter date salah. Gunakan format YYYY-MM-DD.'
        });
    }

    try {
        // 3. LOGIKA PENGURUTAN (ORDER BY) DINAMIS
        // Jika status = 'waiting', diurutkan berdasarkan urutan fisik pemanggilan (sequence_order ASC)
        // Selain status tersebut, diurutkan berdasarkan urutan waktu mendaftar (queue_number ASC)
        let orderByClause = 'ORDER BY queue_number ASC';
        
        if (status === 'waiting') {
            orderByClause = 'ORDER BY sequence_order ASC';
        }

        // 4. Susun query SQL dan eksekusi ke TiDB Cloud
        const query = `
            SELECT * FROM queues 
            WHERE status = ? AND queue_date = ?
            ${orderByClause}
        `;

        const [rows] = await db.query(query, [status, targetDate]);

        res.json({
            status: 'success',
            meta: {
                filtered_status: status,
                filtered_date: targetDate,
                sorted_by: status === 'waiting' ? 'sequence_order' : 'queue_number',
                total_data: rows.length
            },
            data: rows
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Gagal mengambil data antrean berdasarkan status.',
            error: error.message
        });
    }
});

// ========================================================
// SERVICE REGISTRASI ANTREAN (SEMUA PARAMETER WAJIB + DATE VIA BODY)
// Body Parameter (JSON): 
// { 
//   "date": "2026-05-25", 
//   "name": "Budi", 
//   "address": "Solo", 
//   "whatsapp": "08123", 
//   "email": "budi@email.com" 
// }
// ========================================================
app.post('/api/queue/register', async (req, res) => {
    // 1. Ambil semua input dari request body termasuk date
    const targetDate = req.body?.date?.trim();
    const name = req.body?.name?.trim();
    const address = req.body?.address?.trim();
    const whatsapp = req.body?.whatsapp?.trim();
    const email = req.body?.email?.trim();

    // 2. VALIDASI KELENGKAPAN: Semua parameter tanpa terkecuali wajib diisi
    if (!targetDate || !name || !address || !whatsapp || !email) {
        return res.status(400).json({
            status: 'error',
            message: 'Semua parameter (date, name, address, whatsapp, email) wajib diisi dan tidak boleh kosong.'
        });
    }

    // 3. VALIDASI FORMAT TANGGAL (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(targetDate)) {
        return res.status(400).json({
            status: 'error',
            message: 'Format parameter date salah. Gunakan format YYYY-MM-DD.'
        });
    }

    const dateCompact = targetDate.replace(/-/g, '');
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 4. VALIDASI DUPLIKASI: Cek nama + whatsapp ATAU nama + email pada tanggal yang diinputkan
        const [duplicateRows] = await connection.query(
            `SELECT id FROM queues 
             WHERE queue_date = ? 
             AND customer_name = ? 
             AND (whatsapp_number = ? OR email = ?)`,
            [targetDate, name, whatsapp, email]
        );

        if (duplicateRows.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Pendaftaran gagal. Nama '${name}' dengan nomor WhatsApp/Email tersebut sudah mendaftar untuk tanggal ${targetDate}.`
            });
        }

        // 5. GENERATE NOMOR & KODE ANTREAN BERDASARKAN TANGGAL INPUT
        const [maxNumRows] = await connection.query(
            'SELECT MAX(queue_number) as max_num FROM queues WHERE queue_date = ?', 
            [targetDate]
        );
        const nextQueueNumber = (maxNumRows[0].max_num || 0) + 1;
        
        const paddedNumber = String(nextQueueNumber).padStart(3, '0');
        const queueCode = `Q-${dateCompact}-${paddedNumber}`;

        // 6. INSERT DATA KE DATABASE
        const insertQuery = `
            INSERT INTO queues (queue_date, queue_number, queue_code, sequence_order, customer_name, address, whatsapp_number, email, status) 
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'registered')
        `;
        const [insertResult] = await connection.query(insertQuery, [
            targetDate, nextQueueNumber, queueCode, name, address, whatsapp, email
        ]);

        // 7. AMBIL DATA LENGKAP YANG BARU SAJA DISIMPAN
        const [savedDataRows] = await connection.query(
            'SELECT * FROM queues WHERE id = ?', 
            [insertResult.insertId]
        );

        await connection.commit();

        // 8. RETURN RESPONSE LENGKAP
        res.status(201).json({
            status: 'success',
            message: `Registrasi antrean berhasil disimpan untuk tanggal ${targetDate}.`,
            data: savedDataRows[0]
        });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({
            status: 'error',
            message: 'Gagal melakukan registrasi antrean.',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ========================================================
// SERVICE UPDATE STATUS DENGAN VALIDASI ID & QUEUE_CODE
// Body Parameter (JSON): { "id": 14, "queue_code": "Q-20260520-001", "status": "completed" }
// ========================================================
app.put('/api/queue/update-status', async (req, res) => {
    const id = req.body?.id;
    const queueCode = req.body?.queue_code;
    const newStatus = req.body?.status;

    // 1. Validasi kelengkapan parameter inputan
    if (!id || !queueCode || !newStatus) {
        return res.status(400).json({
            status: 'error',
            message: 'Parameter id, queue_code, dan status wajib diisi.'
        });
    }

    // 2. Batasi variasi status yang diizinkan sesuai skema database ENUM
    const allowedStatus = ['registered', 'reconfirm', 'waiting', 'serving', 'skipped', 'cancelled', 'completed'];
    if (!allowedStatus.includes(newStatus)) {
        return res.status(400).json({
            status: 'error',
            message: `Status tidak valid. Opsi yang diperbolehkan: ${allowedStatus.join(', ')}`
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 3. VALIDASI PENGECEKAN: Cari data berdasarkan ID untuk dicocokkan dengan queue_code
        const [rows] = await connection.query(
            'SELECT queue_code, status, sequence_order FROM queues WHERE id = ? FOR UPDATE', 
            [id]
        );

        // Jika ID tidak ditemukan
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: `Data antrean dengan ID ${id} tidak ditemukan.`
            });
        }

        const currentData = rows[0];

        // JIKA ID ADA, TAPI QUEUE_CODE TIDAK COCOK
        if (currentData.queue_code !== queueCode) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Validasi gagal! ID ${id} tidak cocok dengan Kode Antrean '${queueCode}'.`
            });
        }

        // 4. LOGIKAL TAMBAHAN (Opsional namun penting): 
        // Jika status diubah menjadi 'registered' atau 'cancelled', urutan fisik (sequence_order) sebaiknya di-reset ke 0
        let targetSequenceOrder = currentData.sequence_order;
        if (['registered', 'cancelled'].includes(newStatus)) {
            targetSequenceOrder = 0;
        }

        // 5. Eksekusi Update Status setelah lolos semua validasi
        const updateQuery = `
            UPDATE queues 
            SET status = ?, sequence_order = ? 
            WHERE id = ?
        `;
        await connection.query(updateQuery, [newStatus, targetSequenceOrder, id]);

        await connection.commit();

        res.json({
            status: 'success',
            message: `Status antrean ${queueCode} berhasil diperbarui menjadi '${newStatus}'.`,
            data: {
                id: id,
                queue_code: queueCode,
                old_status: currentData.status,
                new_status: newStatus
            }
        });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({
            status: 'error',
            message: 'Gagal memperbarui status antrean.',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ========================================================
// SERVICE GENERATE DATA DUMMY
// Endpoint: POST /api/queue/dummy
// Body JSON: { "total": 10, "date": "2024-06-20" }
// - total: jumlah data dummy yang ingin digenerate (default: 5)
// - date: tanggal antrean untuk data dummy (format: YYYY-MM-DD, default: hari ini)
// ========================================================
app.post("/api/queue/dummy", async (req, res) => {
  const totalData = req.body?.total ? parseInt(req.body.total) : 5;
  const targetDate = req.body?.date ? req.body.date : getTodayDate();

  const dateCompact = targetDate.replace(/-/g, "");

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (req.body?.date && !dateRegex.test(req.body.date)) {
    return res.status(400).json({
      status: "error",
      message: "Format tanggal harus YYYY-MM-DD.",
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Ambil nomor antrean terakhir untuk melanjutkan urutan
    const [rows] = await connection.query(
      "SELECT MAX(queue_number) as max_num FROM queues WHERE queue_date = ?",
      [targetDate],
    );
    let currentMaxNumber = rows[0].max_num || 0;

    const insertedData = [];

    // Loop generate data menggunakan Faker
    for (let i = 0; i < totalData; i++) {
      currentMaxNumber++;

      // 2. Generate Data Khas Indonesia menggunakan Faker
      const sex = faker.person.sexType(); // Menentukan gender acak ('male' atau 'female')
      const name = faker.person.fullName({ sex });

      // Membuat alamat lengkap standar Indonesia (Nama Jalan, Kecamatan, Kota)
      const address = `${faker.location.street()}, ${faker.location.city()}`;

      // Membuat nomor WA dengan format seluler Indonesia (08xx)
      const whatsapp = faker.phone
        .number({ style: "national" })
        .replace(/\s+/g, "");

      // Membuat email berdasarkan nama yang digenerate
      const email = faker.internet
        .email({ firstName: name.split(" ")[0] })
        .toLowerCase();

      const paddedNumber = String(currentMaxNumber).padStart(3, "0");
      const queueCode = `Q-${dateCompact}-${paddedNumber}`;

      const query = `
                INSERT INTO queues (queue_date, queue_number, queue_code, sequence_order, customer_name, address, whatsapp_number, email, status) 
                VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'registered')
            `;

      await connection.query(query, [
        targetDate,
        currentMaxNumber,
        queueCode,
        name,
        address,
        whatsapp,
        email,
      ]);

      insertedData.push({
        queue_code: queueCode,
        queue_number: currentMaxNumber,
        customer_name: name,
        address: address,
        whatsapp_number: whatsapp,
        email: email,
      });
    }

    await connection.commit();

    res.status(201).json({
      status: "success",
      message: `Berhasil men-generate ${totalData} data dummy realistis (Indonesia) untuk tanggal ${targetDate}`,
      data: insertedData,
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({
      status: "error",
      message: "Gagal generate dummy.",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});


// ========================================================
// SERVICE HAPUS SEMUA DATA ANTREAN BERDASARKAN TANGGAL
// Body Parameter (JSON): { "date": "2026-05-18", "confirm_date": "2026-05-18" }
// ========================================================
app.delete('/api/queue/clear', async (req, res) => {
    // 1. Ambil input dengan aman menggunakan optional chaining
    const date = req.body?.date;
    const confirmDate = req.body?.confirm_date;

    // 2. Validasi kelengkapan parameter
    if (!date || !confirmDate) {
        return res.status(400).json({
            status: 'error',
            message: 'Parameter date dan confirm_date wajib diisi.'
        });
    }

    // 3. Validasi kecocokan kedua tanggal (Double Confirmation)
    if (date !== confirmDate) {
        return res.status(400).json({
            status: 'error',
            message: 'Konfirmasi gagal. Nilai date dan confirm_date tidak cocok.'
        });
    }

    // 4. Validasi format tanggal (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({
            status: 'error',
            message: 'Format tanggal salah. Gunakan format YYYY-MM-DD.'
        });
    }

    try {
        // 5. Eksekusi query DELETE ke TiDB Cloud berdasarkan tanggal
        const query = 'DELETE FROM queues WHERE queue_date = ?';
        const [result] = await db.query(query, [date]);

        // Jika tidak ada baris data yang terhapus
        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: 'success',
                message: `Tidak ada data antrean yang ditemukan pada tanggal ${date}. Tidak ada data yang dihapus.`
            });
        }

        // Sukses menghapus data
        res.json({
            status: 'success',
            message: `Berhasil menghapus seluruh data antrean untuk tanggal ${date}.`,
            meta: {
                deleted_date: date,
                total_rows_deleted: result.affectedRows
            }
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Gagal melakukan penghapusan data antrean.',
            error: error.message
        });
    }
});

// Jika dijalankan di lokal (bukan di Vercel), server butuh app.listen
if (process.env.NODE_ENV !== "production") {
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`Server lokal berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
