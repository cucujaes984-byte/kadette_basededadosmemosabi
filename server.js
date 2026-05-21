const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const dominiosAutorizados = [
    'https://kadette.club',
    'https://www.kadette.club',
    'https://fragrant-glitter-6d36.cucujaes984.workers.dev'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || dominiosAutorizados.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Bloqueado pelo CORS da Kadette Barbershop'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: dominiosAutorizados,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['polling', 'websocket']
});

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
    password: { type: String, required: true },
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' },
    bio: { type: String, default: 'Cliente fiel da Kadette Barbershop! ✂️' },
    role: { type: String, default: 'cliente' }, 
    banned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const mensagemSchema = new mongoose.Schema({
    user: { type: String, required: true },
    texto: { type: String, required: true },
    tempo: { type: String, required: true },
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' },
    criadoEm: { type: Date, default: Date.now },
    role: { type: String, default: 'cliente' }
});
mensagemSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 3600 });
const Mensagem = mongoose.model('Mensagem', mensagemSchema);

// --- LIGAÇÃO MONGODB ---
const MONGO_URI = 'mongodb+srv://sioteconta_db_user:l5BMU5cyhppKjTe4@cluster.orny929.mongodb.net/kadette_barber?appName=Cluster';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Sistemas de dados synchronized com o MongoDB.');
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('kadette2026', salt);
            
            await User.findOneAndUpdate(
                { username: 'admin' },
                { 
                    username: 'admin', 
                    password: hashedPassword,
                    profilePic: 'https://cdn-icons-png.flaticon.com/512/2202/2202112.png',
                    bio: 'Barbeiro Chefe & Administrador do Sistema 💈',
                    role: 'admin',
                    banned: false
                },
                { upsert: true, new: true }
            );
            console.log('--- CONTA MASTER "admin" SINCRONIZADA ---');
        } catch (err) {
            console.error('Erro ao injectar conta admin:', err);
        }
    })
    .catch(err => console.error('Erro fatal na ligação de dados:', err));

// --- LÓGICA EM TEMPO REAL (SOCKET.IO) ---
const utilizadoresConectados = {}; 

io.on('connection', async (socket) => {
    console.log('Utilizador conectado ao Chat.');

    socket.on('registarSocketUser', async (username) => {
        if (username) {
            const userLimpo = username.toLowerCase().trim();
            
            try {
                const checkBan = await User.findOne({ username: userLimpo });
                if (checkBan && checkBan.banned) {
                    socket.emit('forcadoASair', 'A tua conta foi banida permanentemente.');
                    socket.disconnect();
                    return;
                }
            } catch (err) {
                console.error('Erro ao validar ban no Socket:', err);
            }

            utilizadoresConectados[userLimpo] = socket.id;
            console.log(`Mapeado: ${userLimpo} está online.`);
            io.emit('listaOnline', Object.keys(utilizadoresConectados));
        }
    });

    socket.on('disconnect', () => {
        for (const username in utilizadoresConectados) {
            if (utilizadoresConectados[username] === socket.id) {
                console.log(`Utilizador ${username} ficou offline.`);
                delete utilizadoresConectados[username];
                io.emit('listaOnline', Object.keys(utilizadoresConectados));
                break;
            }
        }
    });

    try {
        const historico = await Mensagem.find().sort({ criadoEm: 1 });
        socket.emit('historicoChat', historico);
    } catch (err) {
        console.error('Erro ao ler histórico:', err);
    }

    socket.on('enviarMensagem', async (dados) => {
        try {
            const userLimpo = dados.user.toLowerCase().trim();
            
            const utilizador = await User.findOne({ username: userLimpo });
            if (utilizador && utilizador.banned) {
                socket.emit('forcadoASair', 'Não podes enviar mensagens porque foste banido.');
                socket.disconnect();
                return;
            }

            const horario = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            let fotoFinal = dados.profilePic;
            let cargoFinal = utilizador ? utilizador.role : 'cliente';
            
            if (!fotoFinal || fotoFinal.trim() === '' || fotoFinal.includes('3135715.png')) {
                fotoFinal = utilizador ? utilizador.profilePic : 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
            }

            const novaMsg = new Mensagem({
                user: dados.user,
                texto: dados.texto,
                tempo: horario,
                profilePic: fotoFinal,
                role: cargoFinal
            });
            await novaMsg.save();

            io.emit('receberMensagem', {
                _id: novaMsg._id,
                user: novaMsg.user,
                texto: novaMsg.texto,
                tempo: novaMsg.tempo,
                profilePic: novaMsg.profilePic,
                role: novaMsg.role
            });

            const textoMensagem = dados.texto.toLowerCase();
            const regexPing = /@([a-zA-Z0-9_À-ÿ\-]+)/g;
            let capturas;
            while ((capturas = regexPing.exec(textoMensagem)) !== null) {
                const userPingado = capturas[1].trim();
                if (userPingado === dados.user.toLowerCase().trim()) continue;
                const socketTargetId = utilizadoresConectados[userPingado];
                if (socketTargetId) {
                    io.to(socketTargetId).emit('notificacaoPing', { porUser: dados.user });
                }
            }
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    });
});

// --- ROTAS DA API ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Campos em falta.' });
        const usernameLimpo = username.toLowerCase().trim();
        if (usernameLimpo === 'admin') return res.status(400).json({ message: 'Nome indisponível.' });
        const userExists = await User.findOne({ username: usernameLimpo });
        if (userExists) return res.status(400).json({ message: 'Este utilizador já existe.' });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const newUser = new User({ username: usernameLimpo, password: hashedPassword, role: 'cliente' });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro no registo.' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Campos em falta.' });
        const usernameLimpo = username.toLowerCase().trim();
        const user = await User.findOne({ username: usernameLimpo });
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });
        
        if (user.banned) return res.status(403).json({ message: 'Esta conta foi banida permanentemente da plataforma.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Credenciais inválidas.' });
        
        res.json({ success: true, username: user.username, profilePic: user.profilePic, bio: user.bio, role: user.role });
    } catch (err) { res.status(500).json({ message: 'Erro na autenticação.' }); }
});

app.put('/api/users/role', async (req, res) => {
    try {
        const { username, novoRole } = req.body;
        const targetUser = username.toLowerCase().trim();
        
        if (targetUser === 'admin') return res.status(400).json({ message: 'Não podes alterar o cargo do administrador principal.' });
        if (!['cliente', 'staff'].includes(novoRole)) return res.status(400).json({ message: 'Cargo inválido fornecido.' });

        const atualizado = await User.findOneAndUpdate({ username: targetUser }, { role: novoRole }, { new: true });
        if (!atualizado) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        res.json({ success: true, message: `Cargo de ${atualizado.username} alterado com sucesso para ${novoRole}!` });
    } catch (err) { res.status(500).json({ message: 'Erro ao processar alteração de cargo.' }); }
});

app.put('/api/users/ban', async (req, res) => {
    try {
        const { username } = req.body;
        const targetUser = username.toLowerCase().trim();

        if (targetUser === 'admin') return res.status(400).json({ message: 'Operação proibida. O administrador principal é imune.' });

        const utilizador = await User.findOneAndUpdate({ username: targetUser }, { banned: true }, { new: true });
        if (!utilizador) return res.status(404).json({ message: 'Utilizador não encontrado no sistema.' });

        io.emit('utilizadorBanidoKick', targetUser);

        const socketIdInfrator = utilizadoresConectados[targetUser];
        if (socketIdInfrator) {
            const socketAlvo = io.sockets.sockets.get(socketIdInfrator);
            if (socketAlvo) socketAlvo.disconnect();
            delete utilizadoresConectados[targetUser];
            io.emit('listaOnline', Object.keys(utilizadoresConectados));
        }

        res.json({ success: true, message: `O utilizador ${utilizador.username} foi banido e expulso do ecossistema.` });
    } catch (err) { res.status(500).json({ message: 'Erro ao processar banimento.' }); }
});

// --- NOVA ROTA: WIPE COMPLETO DO CHAT ---
app.delete('/api/chat/wipe', async (req, res) => {
    try {
        await Mensagem.deleteMany({}); 
        io.emit('chatLimpo'); 
        res.json({ success: true, message: 'Histórico global do chat limpo com sucesso!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao limpar a base de dados do chat.' });
    }
});

// --- ROTA DE MARCAÇÕES (Para o teu painel) ---
app.get('/api/marcacoes', async (req, res) => {
    try {
        const lista = await Marcacao.find();
        res.json(lista);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao carregar marcações.' });
    }
});

app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Agendamento cancelado.' });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao eliminar marcação.' });
    }
});

// --- ROTA DE LISTA DE USERS PARA O PAINEL ---
app.get('/api/users', async (req, res) => {
    try {
        const listaUsers = await User.find();
        res.json(listaUsers);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao carregar utilizadores.' });
    }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor ativo na porta ${PORT}`);
});
