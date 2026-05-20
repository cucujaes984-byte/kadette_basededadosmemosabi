const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();
app.use(express.json());

// --- CONFIGURAÇÃO DE SEGURANÇA (DOMÍNIOS CLOUDFLARE) ---
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

// --- 1. SCHEMAS E MODELOS (MONGODB) ---

const marcacaoSchema = new mongoose.Schema({
    username: { type: String, required: true }, 
    nome: { type: String, required: true },
    servico: { type: String, required: true },
    data: { type: String, required: true },
    hora: { type: String, required: true }
});
const Marcacao = mongoose.model('Marcacao', marcacaoSchema);

// MODELO DE UTILIZADOR ATUALIZADO COM FOTO E BIO
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' }, // Avatar padrão
    bio: { type: String, default: 'Cliente fiel da Kadette Barbershop! ✂️' }
});
const User = mongoose.model('User', userSchema);

const mensagemSchema = new mongoose.Schema({
    user: { type: String, required: true },
    texto: { type: String, required: true },
    tempo: { type: String, required: true },
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' }, // Foto no chat
    criadoEm: { type: Date, default: Date.now }
});
mensagemSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 3600 });

const Mensagem = mongoose.model('Mensagem', mensagemSchema);


// --- 2. LIGAÇÃO À BASE DE DADOS ---
const MONGO_URI = 'mongodb+srv://sioteconta_db_user:l5BMU5cyhppKjTe4@cluster.orny929.mongodb.net/kadette_barber?appName=Cluster';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Sistemas de dados sincronizados com o MongoDB.');
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('kadette2026', salt);
            await User.findOneAndUpdate(
                { username: 'admin' },
                { 
                    username: 'admin', 
                    password: hashedPassword,
                    profilePic: 'https://cdn-icons-png.flaticon.com/512/2202/2202112.png',
                    bio: 'Barbeiro Chefe & Administrador do Sistema 💈'
                },
                { upsert: true, new: true }
            );
            console.log('--- CONTA MASTER "admin" SINCRONIZADA ---');
        } catch (err) {
            console.error('Erro ao injetar conta admin:', err);
        }
    })
    .catch(err => console.error('Erro fatal na ligação de dados:', err));


// --- 3. LÓGICA EM TEMPO REAL (SOCKET.IO) ---
io.on('connection', async (socket) => {
    console.log('Utilizador conectado.');

    try {
        const historico = await Mensagem.find().sort({ criadoEm: 1 });
        socket.emit('historicoChat', historico);
    } catch (err) {
        console.error('Erro ao ler histórico:', err);
    }

    socket.on('enviarMensagem', async (dados) => {
        const horario = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        try {
            // Procura a foto atual do utilizador para enviar no chat
            const utilizador = await User.findOne({ username: dados.user.toLowerCase().trim() });
            const fotoDestque = utilizador ? utilizador.profilePic : 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';

            const novaMsg = new Mensagem({
                user: dados.user,
                texto: dados.texto,
                tempo: horario,
                profilePic: fotoDestque
            });
            await novaMsg.save();

            io.emit('receberMensagem', {
                _id: novaMsg._id,
                user: novaMsg.user,
                texto: novaMsg.texto,
                tempo: novaMsg.tempo,
                profilePic: novaMsg.profilePic
            });
        } catch (err) {
            console.error('Erro ao salvar mensagem:', err);
        }
    });
});


// --- 4. ROTAS DA API ---

// REGISTAR CONTA
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

        const newUser = new User({ username: usernameLimpo, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (err) { 
        res.status(500).json({ message: 'Erro no registo interno.' }); 
    }
});

// FAZER LOGIN (DEVOLVE OS DADOS DO PERFIL)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Campos em falta.' });

        const usernameLimpo = username.toLowerCase().trim();
        const user = await User.findOne({ username: usernameLimpo });
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Credenciais inválidas.' });
        
        res.json({ 
            success: true, 
            username: user.username,
            profilePic: user.profilePic,
            bio: user.bio
        });
    } catch (err) { 
        res.status(500).json({ message: 'Erro na autenticação interna.' }); 
    }
});

// ATUALIZAR PERFIL (FOTO E BIO)
app.put('/api/users/profile', async (req, res) => {
    try {
        const { username, profilePic, bio } = req.body;
        if (!username) return res.status(400).json({ message: 'Utilizador não identificado.' });

        const userLimpo = username.toLowerCase().trim();
        
        const userAtualizado = await User.findOneAndUpdate(
            { username: userLimpo },
            { profilePic, bio },
            { new: true }
        );

        if (!userAtualizado) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        res.json({ 
            success: true, 
            profilePic: userAtualizado.profilePic, 
            bio: userAtualizado.bio 
        });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao atualizar dados de perfil.' });
    }
});

// ALTERAR NOME DE UTILIZADOR
app.put('/api/users/update-username', async (req, res) => {
    try {
        const { usernameAtual, novoUsername } = req.body;
        if (!usernameAtual || !novoUsername) return res.status(400).json({ message: 'Campos em falta.' });

        const antigo = usernameAtual.toLowerCase().trim();
        const novo = novoUsername.toLowerCase().trim();

        if (novo === 'admin') return res.status(400).json({ message: 'Não podes usar o nome admin.' });
        if (antigo === 'admin') return res.status(400).json({ message: 'O administrador principal não pode mudar de nome.' });

        const userExists = await User.findOne({ username: novo });
        if (userExists) return res.status(400).json({ message: 'Este nome já está em uso.' });

        const usuarioAtualizado = await User.findOneAndUpdate({ username: antigo }, { username: novo }, { new: true });
        if (!usuarioAtualizado) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        await Marcacao.updateMany({ username: antigo }, { username: novo });

        res.json({ success: true, novoUsername: novo });
    } catch (err) { 
        res.status(500).json({ message: 'Erro ao atualizar username.' }); 
    }
});

// VER TODOS OS UTILIZADORES (APENAS ADMIN)
app.get('/api/users', async (req, res) => {
    try {
        const requester = req.query.adminUser;
        if (!requester || requester.toLowerCase() !== 'admin') return res.status(403).json({ message: 'Acesso negado.' });
        const listaClientes = await User.find({ username: { $ne: 'admin' } }).select('-password');
        res.json(listaClientes);
    } catch (err) { res.status(500).json({ message: 'Erro ao listar contas.' }); }
});

// APAGAR CONTA
app.delete('/api/users/:username', async (req, res) => {
    try {
        const targetUser = req.params.username.toLowerCase().trim();
        await User.findOneAndDelete({ username: targetUser });
        await Marcacao.deleteMany({ username: targetUser }); 
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao remover conta.' }); }
});

// VER MARCAÇÕES
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

// REMOVER MARCAÇÃO
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao remover agendamento.' }); }
});

// APAGAR MENSAGEM MANUALMENTE
app.delete('/api/chat/:id', async (req, res) => {
    try {
        const msgId = req.params.id;
        await Mensagem.findByIdAndDelete(msgId);
        io.emit('mensagemApagada', msgId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao apagar mensagem.' }); }
});
// NO TEU SERVIDOR NODE.JS (EXPRESS/SOCKET.IO)
socket.on('enviarMensagem', async (dados) => {
    try {
        // Criar o objeto da mensagem a guardar na Base de Dados
        const novaMensagem = {
            user: dados.user,
            texto: dados.texto,
            profilePic: dados.profilePic || '', // <--- GUARDA A FOTO QUE VEIO DO CLIENTE
            tempo: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
        };

        // Supondo que usas o MongoDB/Mongoose ou outra BD para guardar:
        // const msgSalva = await ChatModel.create(novaMensagem);
        
        // REPASSA PARA TODOS OS UTILIZADORES LIGADOS (Incluindo a foto real)
        io.emit('receberMensagem', novaMensagem); 

    } catch (err) {
        console.error("Erro ao processar mensagem do chat:", err);
    }
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor Kadette ativo na porta ${PORT}`));
