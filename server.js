const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();

// Aumentado para 50mb para garantir que nenhuma imagem/áudio em base64 seja bloqueada no Express
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// maxHttpBufferSize configurado para 50MB para suportar uploads de imagens e gravações de áudio inline
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024, // Os teus 50MB atuais
    cors: {
        origin: function (origin, callback) {
            if (!origin || dominiosAutorizados.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Bloqueado pelo CORS da Kadette Barbershop'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    },
    // 👇 ADICIONA ESTAS DUAS LINHAS AQUI EM BAIXO 👇
    pingTimeout: 60000,  // Espera até 60 segundos antes de derrubar a conexão por falta de resposta
    pingInterval: 25000  // Envia um sinal de vida a cada 25 segundos
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
    role: { type: String, default: 'cliente' },
    canal: { type: String, default: 'global' },
    reacoes: [{
        user: { type: String, required: true },
        emoji: { type: String, required: true }
    }]
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
                    socket.disconnect(true);
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
        console.error('Erro ao leer histórico:', err);
    }

    socket.on('enviarMensagem', async (dados) => {
        try {
            const userLimpo = dados.user.toLowerCase().trim();
            
            const utilizador = await User.findOne({ username: userLimpo });
            if (utilizador && utilizador.banned) {
                socket.emit('forcadoASair', 'Não podes enviar mensagens porque foste banido da plataforma.');
                socket.disconnect(true);
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
                role: cargoFinal,
                canal: dados.canal || 'global',
                reacoes: []
            });
            await novaMsg.save();

            const canalMsg = dados.canal || 'global';
            io.emit('receberMensagem', {
                _id: novaMsg._id,
                user: novaMsg.user,
                texto: novaMsg.texto,
                tempo: novaMsg.tempo,
                profilePic: novaMsg.profilePic,
                role: novaMsg.role,
                reacoes: novaMsg.reacoes,
                canal: canalMsg
            });

            if (dados.texto && 
                !dados.texto.startsWith('__KADETTE_IMG__') && 
                !dados.texto.startsWith('__KADETTE_GIF__') &&
                !dados.texto.startsWith('__KADETTE_AUDIO__')) {
                
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
            }
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    });

    socket.on('reagirMensagem', async (dados) => {
        try {
            const { idMensagem, user, emoji } = dados;
            const msg = await Mensagem.findById(idMensagem);
            if (!msg) return;

            if (!msg.reacoes) msg.reacoes = [];
            const reacaoIndex = msg.reacoes.findIndex(r => r.user === user);

            if (reacaoIndex !== -1) {
                if (msg.reacoes[reacaoIndex].emoji === emoji) {
                    msg.reacoes.splice(reacaoIndex, 1);
                } else {
                    msg.reacoes[reacaoIndex].emoji = emoji;
                }
            } else {
                msg.reacoes.push({ user, emoji });
            }

            await msg.save();
            io.emit('mensagemAtualizada', msg);
        } catch (err) {
            console.error("Erro ao gerir reação no socket:", err);
        }
    });

    // ── CANAIS ──
    // Mensagens usam io.emit (broadcast) — cliente filtra pelo campo canal.
    // joinChannel serve apenas para recarregar o histórico ao mudar de canal.
    socket.on('joinChannel', (dados) => {
        const { canal } = dados;
        if (!canal || canal.startsWith('__')) return;
        if (canal === 'global') {
            Mensagem.find().sort({ criadoEm: 1 })
                .then(historico => socket.emit('historicoChat', historico))
                .catch(err => console.error('Erro ao carregar histórico:', err));
        } else {
            socket.emit('historicoChat', []);
        }
    });

    // ── MENSAGENS DIRETAS (DMs) ──
    socket.on('enviarDM', async (dados) => {
        try {
            const { user, para, texto, profilePic, tempo } = dados;
            if (!user || !para || !texto) return;

            const userLimpo = user.toLowerCase().trim();
            const paraLimpo = para.toLowerCase().trim();

            // Valida ban
            const utilizador = await User.findOne({ username: userLimpo });
            if (utilizador && utilizador.banned) {
                socket.emit('forcadoASair', 'Não podes enviar mensagens porque foste banido da plataforma.');
                socket.disconnect(true);
                return;
            }

            const horario = tempo || new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

            const msgPayload = {
                _id: new (require('mongoose').Types.ObjectId)().toString(),
                user,
                para,
                texto,
                tempo: horario,
                profilePic: profilePic || '',
                role: utilizador ? utilizador.role : 'cliente'
            };

            // Envia ao destinatário (se online)
            const socketDestinatario = utilizadoresConectados[paraLimpo];
            if (socketDestinatario) {
                io.to(socketDestinatario).emit('receberDM', msgPayload);
            }
            // Nota: não reenviamos ao remetente — o cliente já mostra localmente

        } catch (err) {
            console.error('Erro ao processar DM:', err);
        }
    });

    // ── INDICADOR DE ESCRITA EM DM ──
    socket.on('dmTyping', (dados) => {
        const { user, para } = dados;
        if (!user || !para) return;
        const paraLimpo = para.toLowerCase().trim();
        const socketDest = utilizadoresConectados[paraLimpo];
        if (socketDest) {
            io.to(socketDest).emit('dmTyping', { user, para });
        }
    });

    socket.on('dmStopTyping', (dados) => {
        const { user, para } = dados;
        if (!user || !para) return;
        const paraLimpo = para.toLowerCase().trim();
        const socketDest = utilizadoresConectados[paraLimpo];
        if (socketDest) {
            io.to(socketDest).emit('dmStopTyping', { user, para });
        }
    });

    // SISTEMA DE WIPE VIA EVENTO SOCKET PROTEGIDO (Garante funcionamento instantâneo e seguro)
    socket.on('solicitarWipeChat', async (dados) => {
        try {
            if (!dados || !dados.username) return;
            const quemPediu = dados.username.toLowerCase().trim();

            // Validação de segurança na Base de Dados
            const userDb = await User.findOne({ username: quemPediu });
            if (!userDb || (userDb.role !== 'admin' && userDb.role !== 'staff')) {
                console.log(`[WIPE NEGADO] Tentativa não autorizada detetada por: ${quemPediu}`);
                socket.emit('forcadoASair', 'Não tens permissões de moderador para limpar o chat.');
                socket.disconnect(true);
                return;
            }

            const resultado = await Mensagem.deleteMany({});
            console.log(`[WIPE VIA SOCKET] Base de dados limpa por ${userDb.username}. ${resultado.deletedCount} mensagens apagadas.`);
            io.emit('chatLimpo');
        } catch (err) {
            console.error('Erro fatal ao processar wipe via socket:', err);
        }
    });
});

// --- SCHEMA MARKETPLACE ---
const produtoSchema = new mongoose.Schema({
    titulo:     { type: String, required: true },
    descricao:  { type: String, default: '' },
    preco:      { type: Number, required: true },
    categoria:  { type: String, default: 'outros' },
    condicao:   { type: String, default: 'Bom Estado' },
    imagem:     { type: String, default: '' },
    seller:     { type: String, required: true },
    sold:       { type: Boolean, default: false },
    comentarios:{ type: Array, default: [] },
    criadoEm:   { type: Date, default: Date.now }
});
const Produto = mongoose.model('Produto', produtoSchema);

// --- ROTAS DA API ---

// MARKETPLACE — listar
app.get('/api/marketplace', async (req, res) => {
    try {
        const produtos = await Produto.find().sort({ criadoEm: -1 });
        res.json(produtos);
    } catch (err) { res.status(500).json({ message: 'Erro ao carregar produtos.' }); }
});

// MARKETPLACE — criar
app.post('/api/marketplace', async (req, res) => {
    try {
        const { titulo, descricao, preco, categoria, condicao, imagem, seller, sold, comentarios } = req.body;
        if (!titulo || !seller || preco === undefined) return res.status(400).json({ message: 'Campos obrigatórios em falta.' });
        const novo = new Produto({ titulo, descricao, preco, categoria, condicao, imagem, seller, sold: sold || false, comentarios: comentarios || [] });
        await novo.save();
        res.status(201).json(novo);
    } catch (err) { res.status(500).json({ message: 'Erro ao criar produto.' }); }
});

// MARKETPLACE — atualizar (ex: marcar vendido)
app.patch('/api/marketplace/:id', async (req, res) => {
    try {
        const atualizado = await Produto.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        if (!atualizado) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json(atualizado);
    } catch (err) { res.status(500).json({ message: 'Erro ao atualizar produto.' }); }
});

// MARKETPLACE — apagar
app.delete('/api/marketplace/:id', async (req, res) => {
    try {
        const apagado = await Produto.findByIdAndDelete(req.params.id);
        if (!apagado) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: 'Erro ao apagar produto.' }); }
});

// MARKETPLACE — adicionar comentário
app.post('/api/marketplace/:id/comments', async (req, res) => {
    try {
        const produto = await Produto.findById(req.params.id);
        if (!produto) return res.status(404).json({ message: 'Produto não encontrado.' });
        produto.comentarios = produto.comentarios || [];
        produto.comentarios.push({ ...req.body, criadoEm: new Date().toISOString() });
        await produto.save();
        res.json(produto);
    } catch (err) { res.status(500).json({ message: 'Erro ao comentar.' }); }
});

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

app.put('/api/users/profile', async (req, res) => {
    try {
        const { username, profilePic, bio } = req.body;
        if (!username) return res.status(400).json({ success: false, message: 'Identificação do utilizador em falta.' });

        const usernameLimpo = username.toLowerCase().trim();
        const dadosAtualizar = {};
        
        if (profilePic !== undefined) dadosAtualizar.profilePic = profilePic;
        if (bio !== undefined) dadosAtualizar.bio = bio;

        const utilizadorAtualizado = await User.findOneAndUpdate(
            { username: usernameLimpo },
            { $set: dadosAtualizar },
            { new: true }
        );

        if (!utilizadorAtualizado) return res.status(404).json({ success: false, message: 'Utilizador não encontrado.' });

        res.json({
            success: true,
            message: 'Perfil guardado com sucesso!',
            user: {
                username: utilizadorAtualizado.username,
                profilePic: utilizadorAtualizado.profilePic,
                bio: utilizadorAtualizado.bio,
                role: utilizadorAtualizado.role
            }
        });
    } catch (err) {
        console.error('Erro ao atualizar perfil:', err);
        res.status(500).json({ success: false, message: 'Erro ao guardar alterações de perfil.' });
    }
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
        if (!username) return res.status(400).json({ message: 'Nome de utilizador em falta.' });
        
        const targetUser = username.toLowerCase().trim();

        if (targetUser === 'admin') return res.status(400).json({ message: 'Operação proibida. O administrador principal é imune.' });

        const utilizadorApagado = await User.findOneAndDelete({ username: targetUser });
        if (!utilizadorApagado) return res.status(404).json({ message: 'Utilizador não encontrado no sistema.' });

        io.emit('utilizadorBanidoKick', targetUser);

        const socketIdInfrator = utilizadoresConectados[targetUser];
        if (socketIdInfrator) {
            const socketAlvo = io.sockets.sockets.get(socketIdInfrator);
            if (socketAlvo) {
                socketAlvo.emit('forcadoASair', 'A tua conta foi eliminada e foste banido da plataforma.');
                socketAlvo.disconnect(true);
                console.log(`[BAN SYSTEM] O utilizador ${targetUser} foi eliminado e o seu socket destruído.`);
            }
            delete utilizadoresConectados[targetUser];
            io.emit('listaOnline', Object.keys(utilizadoresConectados));
        }

        return res.json({ success: true, message: `O utilizador ${utilizadorApagado.username} foi totalmente removido da base de dados.` });
    } catch (err) { 
        console.error('Erro na execução da rota de ban:', err);
        return res.status(500).json({ message: 'Erro ao processar banimento.' }); 
    }
});

// FIX DE ROTAS HTTP: A rota do Wipe foi movida para cima para evitar conflitos com o parâmetro dinâmico ":id"
app.delete('/api/chat/wipe', async (req, res) => {
    try {
        const resultado = await Mensagem.deleteMany({}); 
        console.log(`[WIPE TOTAL HTTP] Base de dados limpa. ${resultado.deletedCount} mensagens apagadas.`);
        
        io.emit('chatLimpo'); 
        return res.status(200).json({ 
            success: true, 
            message: 'Histórico global do chat limpo com sucesso!',
            deletedCount: resultado.deletedCount
        });
    } catch (err) {
        console.error('Erro crítico ao limpar a base de dados do chat:', err);
        return res.status(500).json({ success: false, message: 'Erro ao limpar a base de dados do chat.' });
    }
});

app.delete('/api/chat/:id', async (req, res) => {
    try {
        const msgApagada = await Mensagem.findByIdAndDelete(req.params.id);
        if (!msgApagada) return res.status(404).json({ success: false, message: 'Mensagem não encontrada.' });
        
        io.emit('mensagemApagada', req.params.id);
        res.json({ success: true, message: 'Mensagem removida com sucesso.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao apagar mensagem individual.' });
    }
});

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

app.get('/api/users', async (req, res) => {
    try {
        const listaUsers = await User.find();
        res.json(listaUsers);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao carregar utilizadores.' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor ativo na porta ${PORT}`);
});

// ═══════════════════════════════════════
// MÓDULO MÚSICA
// ═══════════════════════════════════════

const musicaSchema = new mongoose.Schema({
    titulo:     { type: String, required: true },
    artista:    { type: String, default: '' },
    album:      { type: String, default: '' },
    cover:      { type: String, default: '' },
    audio:      { type: String, required: true },
    uploader:   { type: String, required: true },
    duracao:    { type: Number, default: 0 },
    plays:      { type: Number, default: 0 },
    comentarios:{ type: Array, default: [] },
    criadoEm:   { type: Date, default: Date.now }
});
const Musica = mongoose.model('Musica', musicaSchema);

const playlistSchema = new mongoose.Schema({
    nome:       { type: String, required: true },
    descricao:  { type: String, default: '' },
    cover:      { type: String, default: '' },
    owner:      { type: String, required: true },
    musicas:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Musica' }],
    publica:    { type: Boolean, default: true },
    criadoEm:   { type: Date, default: Date.now }
});
const Playlist = mongoose.model('Playlist', playlistSchema);

// MÚSICAS — listar (sem áudio para não sobrecarregar)
app.get('/api/musicas', async (req, res) => {
    try {
        const lista = await Musica.find().select('-audio').sort({ criadoEm: -1 });
        res.json(lista);
    } catch { res.status(500).json({ message: 'Erro ao carregar músicas.' }); }
});

// MÚSICAS — obter áudio
app.get('/api/musicas/:id/audio', async (req, res) => {
    try {
        const m = await Musica.findById(req.params.id).select('audio titulo');
        if (!m) return res.status(404).json({ message: 'Não encontrado.' });
        res.json({ audio: m.audio, titulo: m.titulo });
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// MÚSICAS — upload
app.post('/api/musicas', async (req, res) => {
    try {
        const { titulo, artista, album, cover, audio, uploader, duracao } = req.body;
        if (!titulo || !audio || !uploader) return res.status(400).json({ message: 'Campos em falta.' });
        const nova = new Musica({ titulo, artista, album, cover, audio, uploader, duracao });
        await nova.save();
        const semAudio = nova.toObject();
        delete semAudio.audio;
        res.status(201).json(semAudio);
    } catch { res.status(500).json({ message: 'Erro ao guardar música.' }); }
});

// MÚSICAS — apagar
app.delete('/api/musicas/:id', async (req, res) => {
    try {
        await Musica.findByIdAndDelete(req.params.id);
        await Playlist.updateMany({}, { $pull: { musicas: req.params.id } });
        res.json({ success: true });
    } catch { res.status(500).json({ message: 'Erro ao apagar.' }); }
});

// MÚSICAS — registar play
app.post('/api/musicas/:id/play', async (req, res) => {
    try {
        await Musica.findByIdAndUpdate(req.params.id, { $inc: { plays: 1 } });
        res.json({ success: true });
    } catch { res.json({ success: false }); }
});

// MÚSICAS — adicionar comentário
app.post('/api/musicas/:id/comentarios', async (req, res) => {
    try {
        const { user, texto, profilePic } = req.body;
        if (!user || !texto) return res.status(400).json({ message: 'Campos em falta.' });
        const musica = await Musica.findById(req.params.id);
        if (!musica) return res.status(404).json({ message: 'Não encontrado.' });
        musica.comentarios.push({ user, texto, profilePic, criadoEm: new Date().toISOString(), _id: new mongoose.Types.ObjectId().toString() });
        await musica.save();
        res.json(musica.comentarios);
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// MÚSICAS — apagar comentário
app.delete('/api/musicas/:id/comentarios/:cid', async (req, res) => {
    try {
        const musica = await Musica.findById(req.params.id);
        if (!musica) return res.status(404).json({ message: 'Não encontrado.' });
        musica.comentarios = musica.comentarios.filter(c => c._id !== req.params.cid);
        await musica.save();
        res.json({ success: true });
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// PLAYLISTS — listar públicas
app.get('/api/playlists', async (req, res) => {
    try {
        const lista = await Playlist.find({ publica: true }).sort({ criadoEm: -1 });
        res.json(lista);
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// PLAYLISTS — do utilizador
app.get('/api/playlists/user/:username', async (req, res) => {
    try {
        const lista = await Playlist.find({ owner: req.params.username }).sort({ criadoEm: -1 });
        res.json(lista);
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// PLAYLISTS — criar
app.post('/api/playlists', async (req, res) => {
    try {
        const { nome, descricao, cover, owner, publica } = req.body;
        if (!nome || !owner) return res.status(400).json({ message: 'Campos em falta.' });
        const nova = new Playlist({ nome, descricao, cover, owner, publica: publica !== false });
        await nova.save();
        res.status(201).json(nova);
    } catch { res.status(500).json({ message: 'Erro ao criar playlist.' }); }
});

// PLAYLISTS — adicionar / remover música
app.patch('/api/playlists/:id/musicas', async (req, res) => {
    try {
        const { musicaId, acao } = req.body;
        const pl = await Playlist.findById(req.params.id);
        if (!pl) return res.status(404).json({ message: 'Não encontrado.' });
        if (acao === 'add' && !pl.musicas.map(m=>m.toString()).includes(musicaId)) pl.musicas.push(musicaId);
        if (acao === 'remove') pl.musicas = pl.musicas.filter(m => m.toString() !== musicaId);
        await pl.save();
        res.json(pl);
    } catch { res.status(500).json({ message: 'Erro.' }); }
});

// PLAYLISTS — apagar
app.delete('/api/playlists/:id', async (req, res) => {
    try {
        await Playlist.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch { res.status(500).json({ message: 'Erro.' }); }
});
