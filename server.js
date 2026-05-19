const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. Conectar ao MongoDB (Já configurado com o teu link real da nuvem)
const dbURI = process.env.MONGO_URI;

mongoose.connect(dbURI)
  .then(() => console.log("Base de Dados Kadette Conectada com sucesso!"))
  .catch(err => console.log("Erro de conexão na Base de Dados:", err));

// 2. Definir como é uma Marcação (Schema)
const MarcacaoSchema = new mongoose.Schema({
    nome: String,
    servico: String,
    data: String,
    hora: String
});
const Marcacao = mongoose.model('Marcacao', MarcacaoSchema);

// 3. Rota para RECEBER uma nova marcação do site (POST)
app.post('/api/marcacoes', async (req, res) => {
    try {
        const novaMarcacao = new Marcacao(req.body);
        await novaMarcacao.save();
        res.status(201).json({ mensagem: "Guardado com sucesso na BD!" });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// 4. Rota para LISTAR todas as marcações na tua agenda (GET)
app.get('/api/marcacoes', async (req, res) => {
    try {
        const lista = await Marcacao.find();
        res.json(lista);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// 5. Rota para APAGAR uma marcação (DELETE)
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ mensagem: "Eliminado com sucesso!" });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Ligar o servidor na porta 3000
app.listen(3000, () => console.log("Servidor Kadette a correr na porta 3000"));
