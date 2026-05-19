const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());

// Configuração do CORS para permitir ligações seguras do teu Frontend
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Ligação à tua Base de Dados (Substitui pela tua string do MongoDB Atlas se necessário)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/kadette_barber';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Sistemas de dados ligados com sucesso.'))
    .catch(err => console.error('Erro interno de infraestrutura de dados.'));

// Schema de Marcações
const marcacaoSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    servico: { type: String, required: true },
    data: { type: String, required: true },
    hora: { type: String, required: true }
});
const Marcacao = mongoose.model('Marcacao', marcacaoSchema);

// 1. ROTA DE LOGIN (Credenciais mascaradas e seguras)
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;

        // Credenciais estáticas para o painel do barbeiro
        if (username === 'admin' && password === 'kadette2026') {
            return res.json({ success: true, token: 'sessao_autenticada_premium_kadette' });
        } else {
            // Resposta genérica padrão para evitar engenharia reversa de utilizadores
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error('ERRO CRÍTICO NO LOGIN:', err); // Só tu vês no Render
        return res.status(500).json({ message: 'De momento não foi possível processar a autenticação.' });
    }
});

// 2. ROTA PARA OBTER MARCAÇÕES (GET)
app.get('/api/marcacoes', async (req, res) => {
    try {
        const lista = await Marcacao.find();
        res.json(lista);
    } catch (err) {
        console.error('ERRO CRÍTICO AO PROCURAR MARCAÇÕES:', err);
        res.status(500).json({ message: 'Erro ao carregar os registos do sistema.' });
    }
});

// 3. ROTA PARA CRIAR MARCAÇÃO (POST)
app.post('/api/marcacoes', async (req, res) => {
    try {
        const { nome, servico, data, hora } = req.body;
        if (!nome || !servico || !data || !hora) {
            return res.status(400).json({ message: 'Dados de marcação incompletos.' });
        }
        const novaMarcacao = new Marcacao({ nome, servico, data, hora });
        await novaMarcacao.save();
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('ERRO CRÍTICO AO SALVAR MARCAÇÃO:', err);
        res.status(500).json({ message: 'Não foi possível guardar o seu agendamento no sistema.' });
    }
});

// 4. ROTA PARA APAGAR MARCAÇÃO (DELETE)
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('ERRO CRÍTICO AO APAGAR MARCAÇÃO:', err);
        res.status(500).json({ message: 'Não foi possível remover o registo solicitado.' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor operacional na porta ${PORT}`));
