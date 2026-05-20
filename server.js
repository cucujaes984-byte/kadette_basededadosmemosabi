const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();
app.use(express.json());

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// --- 1. SCHEMAS E MODELOS ---

const marcacaoSchema = new mongoose.Schema({
    username: { type: String, required: true }, 
    nome: { type: String, required: true },
    servico: { type: String, required: true },
    data: { type: String, required: true },
    hora: { type: String, required: true }
});
const Marcacao = mongoose.model('Marcacao', marcacaoSchema);

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// NOVO: Schema de Mensagem com Auto-Delete após 1 hora (3600 segundos)
const mensagemSchema = new mongoose.Schema({
    user: { type: String, required: true },
    texto: { type: String, required: true },
    tempo: { type: String, required: true },
    criadoEm: { type: Date, default: Date.now }
});

// Cria um índice que apaga o documento 3600 segundos (1 hora) após o 'criadoEm'
mensagemSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 3600 });

const Mensagem = mongoose.model('Mensagem', mensagemSchema);


// --- 2. LIGAÇÃO À BASE DE DADOS + RESET DO ADMIN ---

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/kadette_barber';
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Sistemas de dados sincronizados com o MongoDB.');
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('kadette2026', salt);
            await User.findOneAndUpdate(
                { username: 'admin' },
                { username: 'admin', password: hashedPassword },
                { upsert: true, new: true }
            );
            console.log('--- CONTA MASTER "admin" SINCRONIZADA (kadette2026) ---');
        } catch (err) {
            console.error('Erro ao injetar conta admin:', err);
        }
    })
    .catch(err => console.error('Erro fatal na ligação de dados:', err));


// --- 3. LÓGICA DO CHAT GLOBAL ---

io.on('connection', async (socket) => {
    console.log('Utilizador conectado ao chat.');

    // 1. IMPORTANTE: Assim que qualquer utilizador liga, ele recebe TODAS as mensagens da última hora
    try {
        const historico = await Mensagem.find().sort({ criadoEm: 1 });
        socket.emit('historicoChat', historico);
    } catch (err) {
        console.error('Erro ao carregar histórico:', err);
    }

    // 2. Ouvir novas mensagens enviadas
    socket.on('enviarMensagem', async (dados) => {
        const horario = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        try {
            const novaMsg = new Mensagem({
                user: dados.user,
                texto: dados.texto,
                tempo: horario
            });
            await novaMsg.save();

            // Envia para toda a gente em tempo real (incluindo o ID do banco de dados)
            io.emit('receberMensagem', {
                _id: novaMsg._id,
                user: novaMsg.user,
                texto: novaMsg.texto,
                tempo: novaMsg.tempo
            });
        } catch (err) {
            console.error('Erro ao guardar mensagem:', err);
        }
    });
});

// FORÇA O CHAT A LIGAR POR COMPATIBILIDADE MÁXIMA E A CONECTAR SOZINHO SE CAIR
const socket = io('https://kadette-basededadosmemosabi.onrender.com', {
    transports: ['polling', 'websocket'], // Tenta polling primeiro (nunca falha) e sobe para websocket
    upgrade: true,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
});

// AVISO DE DIAGNÓSTICO (Podes ver no F12 do teu PC se está mesmo ligado)
socket.on('connect', () => {
    console.log('Ligação em tempo real estabelecida com sucesso!');
});

socket.on('connect_error', (error) => {
    console.error('Erro de ligação em tempo real, a tentar recuperar...', error);
});
// --- 4. ROTAS DA API ---

// REGISTO DE NOVOS CLIENTES
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Campos em falta.' });
        if (username.toLowerCase().trim() === 'admin') return res.status(400).json({ message: 'Nome indisponível.' });

        const userExists = await User.findOne({ username: username.toLowerCase().trim() });
        if (userExists) return res.status(400).json({ message: 'Este utilizador já existe.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username: username.toLowerCase().trim(), password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro no registo.' }); }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username: username.toLowerCase().trim() });
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Credenciais inválidas.' });
        res.json({ success: true, username: user.username });
    } catch (err) { res.status(500).json({ message: 'Erro na autênticação.' }); }
});

// ALTERAR NOME DE UTILIZADOR (USERNAME)
app.put('/api/users/update-username', async (req, res) => {
    try {
        const { usernameAtual, novoUsername } = req.body;

        if (!usernameAtual || !novoUsername) {
            return res.status(400).json({ message: 'Campos em falta.' });
        }

        const antigo = usernameAtual.toLowerCase().trim();
        const novo = novoUsername.toLowerCase().trim();

        if (novo === 'admin') {
            return res.status(400).json({ message: 'Não podes usar o nome admin.' });
        }

        if (antigo === 'admin') {
            return res.status(400).json({ message: 'O administrador master não pode mudar de nome por aqui.' });
        }

        // 1. Verifica se o novo nome já existe na base de dados
        const userExists = await User.findOne({ username: novo });
        if (userExists) {
            return res.status(400).json({ message: 'Este nome de utilizador já está a ser utilizado.' });
        }

        // 2. Atualiza o nome no registo do Utilizador
        const usuarioAtualizado = await User.findOneAndUpdate(
            { username: antigo },
            { username: novo },
            { new: true }
        );

        if (!usuarioAtualizado) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }

        // 3. Atualiza também o histórico de marcações deste cliente para o novo nome
        await Marcacao.updateMany({ username: antigo }, { username: novo });

        res.json({ success: true, novoUsername: novo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro ao atualizar o nome de utilizador.' });
    }
});
// VER UTILIZADORES (ADMIN)
app.get('/api/users', async (req, res) => {
    try {
        const requester = req.query.adminUser;
        if (!requester || requester.toLowerCase() !== 'admin') return res.status(403).json({ message: 'Acesso negado.' });
        const listaClientes = await User.find({ username: { $ne: 'admin' } }).select('-password');
        res.json(listaClientes);
    } catch (err) { res.status(500).json({ message: 'Erro ao listar contas.' }); }
});

// APAGAR CONTA (ADMIN)
app.delete('/api/users/:username', async (req, res) => {
    try {
        const targetUser = req.params.username.toLowerCase().trim();
        await User.findOneAndDelete({ username: targetUser });
        await Marcacao.deleteMany({ username: targetUser }); 
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao remover conta.' }); }
});

// OBTER MARCAÇÕES
app.get('/api/marcacoes', async (req, res) => {
    try {
        const queryUser = req.query.user;
        if (!queryUser) return res.status(400).json({ message: 'Falta identificação.' });
        let lista = queryUser.toLowerCase().trim() === 'admin' ? await Marcacao.find() : await Marcacao.find({ username: queryUser.toLowerCase().trim() });
        res.json(lista);
    } catch (err) { res.status(500).json({ message: 'Erro ao ler agenda.' }); }
});

// CRIAR MARCAÇÃO
app.post('/api/marcacoes', async (req, res) => {
    try {
        const { username, nome, servico, data, hora } = req.body;
        const novaMarcacao = new Marcacao({ username: username.toLowerCase().trim(), nome, servico, data, hora });
        await novaMarcacao.save();
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao salvar marcação.' }); }
});

// APAGAR MARCAÇÃO
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao remover.' }); }
});

// APAGAR MENSAGEM MANUALMENTE (MODERAÇÃO DO ADMIN)
app.delete('/api/chat/:id', async (req, res) => {
    try {
        const msgId = req.params.id;
        await Mensagem.findByIdAndDelete(msgId);
        io.emit('mensagemApagada', msgId); 
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao apagar mensagem.' }); }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
