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

// Servidor HTTP necessário para o funcionamento do Socket.io
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// --- LIGAÇÃO À BASE DE DADOS + CRIAÇÃO DO ADMIN AUTOMÁTICO ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/kadette_barber';
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Sistemas de dados sincronizados.');
        
        // Garante que o admin com a password "kadette2026" existe sempre
        try {
            const adminExiste = await User.findOne({ username: 'admin' });
            if (!adminExiste) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash('kadette2026', salt);
                
                const adminUser = new User({
                    username: 'admin',
                    password: hashedPassword
                });
                
                await adminUser.save();
                console.log('--- CONTA MASTER ADMIN CONFIGURADA COM SUCESSO ---');
            }
        } catch (err) {
            console.error('Erro ao injetar conta admin automática:', err);
        }
    })
    .catch(err => console.error('Erro na ligação de dados.'));

// --- SCHEMAS ---

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

// --- LÓGICA DO CHAT GLOBAL ---
io.on('connection', (socket) => {
    socket.on('enviarMensagem', (dados) => {
        io.emit('receberMensagem', {
            user: dados.user,
            texto: dados.texto,
            tempo: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });
});

// --- ROTAS DA API ---

// REGISTO DE UTILIZADORES
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Campos em falta.' });

        const userExists = await User.findOne({ username: username.toLowerCase().trim() });
        if (userExists) return res.status(400).json({ message: 'Este utilizador já existe.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username: username.toLowerCase().trim(), password: hashedPassword });
        await newUser.save();

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao processar registo.' });
    }
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
    } catch (err) {
        res.status(500).json({ message: 'Erro na autenticação.' });
    }
});

// OBTER MARCAÇÕES (FILTRADO POR UTILIZADOR / ADMIN VÊ TUDO)
app.get('/api/marcacoes', async (req, res) => {
    try {
        const queryUser = req.query.user;
        if (!queryUser) return res.status(400).json({ message: 'Falta identificação do utilizador.' });

        let lista;
        if (queryUser.toLowerCase() === 'admin') {
            lista = await Marcacao.find();
        } else {
            lista = await Marcacao.find({ username: queryUser.toLowerCase() });
        }
        
        res.json(lista);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao ler dados da agenda.' });
    }
});

// CRIAR MARCAÇÃO VINCULADA AO UTILIZADOR
app.post('/api/marcacoes', async (req, res) => {
    try {
        const { username, nome, servico, data, hora } = req.body;
        if (!username || !nome || !servico || !data || !hora) {
            return res.status(400).json({ message: 'Dados incompletos.' });
        }

        const novaMarcacao = new Marcacao({ 
            username: username.toLowerCase().trim(), 
            nome, 
            servico, 
            data, 
            hora 
        });
        
        await novaMarcacao.save();
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao salvar marcação.' });
    }
});

// APAGAR MARCAÇÃO
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao remover.' });
    }
});

// Inicialização com o server do HTTP para não bloquear os WebSockets
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
