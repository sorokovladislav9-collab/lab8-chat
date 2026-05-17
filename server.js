const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Настройка EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Игровые данные (можно вынести в отдельный модуль)
const questions = [
  { question: 'Сколько будет 2+2?', answer: '4' },
  { question: 'Столица Франции?', answer: 'Париж' },
  { question: 'Самый большой океан?', answer: 'Тихий' }
];

// Состояние игры
let gameState = {
  active: false,
  currentQuestionIndex: 0,
  users: {},           // { socketId: { name, score } }
  questionTimer: null,
  questionTimeout: 15000  // 15 секунд на ответ
};

// Вспомогательные функции
function resetGame() {
  clearTimeout(gameState.questionTimer);
  gameState.active = false;
  gameState.currentQuestionIndex = 0;
  gameState.users = {};
  io.emit('gameState', { active: false, message: 'Игра сброшена. Ожидание начала.' });
}

function startGame() {
  if (Object.keys(gameState.users).length === 0) {
    io.emit('message', { user: 'Сервер', text: 'Нет игроков для начала игры.' });
    return;
  }
  gameState.active = true;
  gameState.currentQuestionIndex = 0;
  // Обнуляем очки
  for (let id in gameState.users) {
    gameState.users[id].score = 0;
  }
  sendQuestion();
}

function sendQuestion() {
  if (gameState.currentQuestionIndex >= questions.length) {
    endGame();
    return;
  }
  const q = questions[gameState.currentQuestionIndex];
  io.emit('question', { 
    index: gameState.currentQuestionIndex + 1, 
    total: questions.length, 
    question: q.question,
    time: gameState.questionTimeout / 1000
  });
  // Таймер автоматического перехода к следующему вопросу
  gameState.questionTimer = setTimeout(() => {
    io.emit('message', { user: 'Сервер', text: 'Время вышло! Переходим к следующему вопросу.' });
    gameState.currentQuestionIndex++;
    sendQuestion();
  }, gameState.questionTimeout);
}

function endGame() {
  clearTimeout(gameState.questionTimer);
  gameState.active = false;
  // Определяем победителей
  const scores = Object.entries(gameState.users).map(([id, u]) => ({ name: u.name, score: u.score }));
  scores.sort((a, b) => b.score - a.score);
  io.emit('gameOver', { scores });
  io.emit('gameState', { active: false, message: 'Игра завершена!' });
}

// Маршруты
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/chat', (req, res) => {
  res.render('chat');
});

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Регистрация имени
  socket.on('setUsername', (name) => {
    gameState.users[socket.id] = { name, score: 0 };
    socket.username = name;
    io.emit('userList', Object.values(gameState.users).map(u => u.name));
    io.emit('message', { user: 'Сервер', text: `${name} присоединился к игре.` });
  });

  // Запуск игры (может сделать любой игрок или админ)
  socket.on('startGame', () => {
    if (!gameState.active) {
      startGame();
    } else {
      socket.emit('message', { user: 'Сервер', text: 'Игра уже идёт.' });
    }
  });

  // Обработка ответа
  socket.on('answer', (answer) => {
    if (!gameState.active) return;
    const user = gameState.users[socket.id];
    if (!user) return;
    const currentQuestion = questions[gameState.currentQuestionIndex];
    if (currentQuestion && answer.trim().toLowerCase() === currentQuestion.answer.toLowerCase()) {
      user.score += 10;
      socket.emit('message', { user: 'Сервер', text: 'Правильно! +10 очков.' });
      // Автоматический переход к следующему вопросу (можно также ждать всех)
      clearTimeout(gameState.questionTimer);
      gameState.currentQuestionIndex++;
      sendQuestion();
    } else {
      socket.emit('message', { user: 'Сервер', text: 'Неправильно.' });
    }
  });

  // Сброс игры (опционально)
  socket.on('resetGame', () => {
    resetGame();
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    if (gameState.users[socket.id]) {
      const name = gameState.users[socket.id].name;
      delete gameState.users[socket.id];
      io.emit('userList', Object.values(gameState.users).map(u => u.name));
      io.emit('message', { user: 'Сервер', text: `${name} покинул игру.` });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});