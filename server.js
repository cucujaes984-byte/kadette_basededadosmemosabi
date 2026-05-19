const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Install via: npm install bcryptjs

const app = express();
app.use(express.json());

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/kadette_barber';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Database connected.'))
    .catch(err => console.error('Database connection error.'));

// --- SCHEMAS ---

// Appointments Schema
const marcacaoSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    servico: { type: String, required: true },
    data: { type: String, required: true },
    hora: { type: String, required: true }
});
const Marcacao = mongoose.model('Marcacao', marcacaoSchema);

// Users Schema (New)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);


// --- ROUTES ---

// 1. REGISTER ROUTE (New: Allows anyone to create an account safely)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Missing fields.' });
        }

        // Check if username already exists
        const userExists = await User.findOne({ username: username.toLowerCase() });
        if (userExists) {
            return res.status(400).json({ message: 'Username already exists.' });
        }

        // Securely hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Save to MongoDB
        const newUser = new User({ username: username.toLowerCase(), password: hashedPassword });
        await newUser.save();

        res.status(201).json({ success: true });
    } catch (err) {
        console.error('REGISTRATION ERROR:', err);
        res.status(500).json({ message: 'Could not complete registration.' });
    }
});

// 2. LOGIN ROUTE (Updated: Checks credentials against MongoDB)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user in database
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Compare hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        res.json({ success: true, token: 'session_authenticated_user' });
    } catch (err) {
        console.error('LOGIN ERROR:', err);
        res.status(500).json({ message: 'Authentication error.' });
    }
});

// 3. GET APPOINTMENTS
app.get('/api/marcacoes', async (req, res) => {
    try {
        const lista = await Marcacao.find();
        res.json(lista);
    } catch (err) {
        res.status(500).json({ message: 'Error loading data.' });
    }
});

// 4. CREATE APPOINTMENT
app.post('/api/marcacoes', async (req, res) => {
    try {
        const { nome, servico, data, hora } = req.body;
        const novaMarcacao = new Marcacao({ nome, servico, data, hora });
        await novaMarcacao.save();
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error saving appointment.' });
    }
});

// 5. DELETE APPOINTMENT
app.delete('/api/marcacoes/:id', async (req, res) => {
    try {
        await Marcacao.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting data.' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
