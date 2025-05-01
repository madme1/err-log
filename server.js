const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

// Initialize SQLite database
const db = new sqlite3.Database('messages.db'); // Use ':memory:' for temp db or 'messages.db' for file-based

// Create messages table
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

let clients = [];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sender.html'));
});

app.get('/receiver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receiver.html'));
});

// API to send messages
app.post('/send-message', (req, res) => {
    const { message } = req.body;
    if (message && message.trim() !== '') {
        db.run(
            'INSERT INTO messages (text) VALUES (?)',
            [message],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Get the newly inserted message
                db.get(
                    'SELECT * FROM messages WHERE id = ?',
                    [this.lastID],
                    (err, newMessage) => {
                        if (err || !newMessage) {
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        // Send to all connected clients
                        sendEventsToAll(newMessage);
                        res.status(200).json({ success: true });
                    }
                );
            }
        );
    } else {
        res.status(400).json({ error: 'Message cannot be empty' });
    }
});

// Get all messages
app.get('/get-messages', (req, res) => {
    db.all(
        'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50',
        (err, messages) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json(messages);
        }
    );
});

// SSE endpoint for receiving live updates
app.get('/events', (req, res) => {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    clients.push(newClient);

    // Send initial messages
    db.all(
        'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50',
        (err, messages) => {
            if (!err && messages.length > 0) {
                res.write(`data: ${JSON.stringify({ type: 'init', messages })}\n\n`);
            }
        }
    );

    req.on('close', () => {
        // console.log(`${clientId} Connection closed`);
        clients = clients.filter(c => c.id !== clientId);
    });
});

function sendEventsToAll(message) {
    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify({ type: 'new-message', message })}\n\n`);
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Sender page: http://localhost:3000');
    console.log('Receiver page: http://localhost:3000/receiver');
});
