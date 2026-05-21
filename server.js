const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect('mongodb://localhost:27017/chat');

const mensagemSchema = new mongoose.Schema({
    texto: String,
    criadoEm: { type: Date, default: Date.now }
});

// auto delete após 1h (opcional)
mensagemSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 3600 });

const Mensagem = mongoose.model('Mensagem', mensagemSchema);

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// 🔥 WIPE VIA API
app.delete('/api/chat/wipe', async (req, res) => {
    await Mensagem.deleteMany({});
    io.emit('chatLimpo'); // 🔥 avisa TODOS
    res.json({ success: true });
});

io.on('connection', async (socket) => {

    console.log('User conectado');

    // enviar histórico
    const historico = await Mensagem.find().sort({ criadoEm: 1 });
    socket.emit('historicoChat', historico);

    // nova mensagem
    socket.on('novaMensagem', async (msg) => {
        const nova = await Mensagem.create({ texto: msg });
        io.emit('mensagem', nova);
    });

    // 🔥 WIPE VIA SOCKET (melhor método)
    socket.on('solicitarWipeChat', async () => {
        await Mensagem.deleteMany({});
        io.emit('chatLimpo');
    });
});

server.listen(3000, () => {
    console.log('Servidor a correr na porta 3000');
});
