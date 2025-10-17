const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const bcrypt = require("bcryptjs");
const excelJS = require("exceljs");

// Import models
const User = require("./models/User");
const Task = require("./models/Task");

const app = express();

// ===== MIDDLEWARE =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// ===== CONNECT MONGODB =====
mongoose
  .connect("mongodb://127.0.0.1:27017/taskmanager", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("MongoDB connection error:", err));

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  if (!req.session.userId) return res.redirect("/");
  next();
}

// ===== ROUTES =====

// Login page
app.get("/", (req, res) => {
  if (!req.session.userId) {
    res.sendFile(path.join(__dirname, "public", "login.html"));
  } else {
    res.redirect("/tasks");
  }
});

// Register page
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// ===== AUTH ROUTES =====

// Register POST
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const existing = await User.findOne({ username });
  if (existing)
    return res.redirect("/register?msg=User+already+exists&type=error");

  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed });
  await user.save();
  req.session.userId = user._id;
  res.redirect("/tasks?msg=Registration+successful&type=success");
});

// Login POST
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.redirect("/?msg=No+user+found&type=error");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.redirect("/?msg=Invalid+password&type=error");

  req.session.userId = user._id;
  res.redirect("/tasks?msg=Login+successful&type=success");
});

// ===== TASK ROUTES =====

// Tasks page
app.get("/tasks", authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tasks", "index.html"));
});

// Add task
app.post("/add-task", authMiddleware, async (req, res) => {
  const task = new Task({
    userId: req.session.userId,
    title: req.body.title,
    completed: false,
  });
  await task.save();
  res.redirect("/tasks?msg=Task+added&type=success");
});

// Get tasks as JSON
app.get("/get-tasks", authMiddleware, async (req, res) => {
  const tasks = await Task.find({ userId: req.session.userId });
  res.json(tasks);
});

// Toggle completion
app.get("/toggle-task/:id", authMiddleware, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (task && task.userId.equals(req.session.userId)) {
    task.completed = !task.completed;
    await task.save();
  }
  res.redirect("/tasks?msg=Task+updated&type=success");
});

// Delete task
app.get("/delete-task/:id", authMiddleware, async (req, res) => {
  await Task.deleteOne({ _id: req.params.id, userId: req.session.userId });
  res.redirect("/tasks?msg=Task+deleted&type=success");
});

// Download Excel
app.get("/tasks/download", authMiddleware, async (req, res) => {
  const tasks = await Task.find({ userId: req.session.userId });
  const workbook = new excelJS.Workbook();
  const worksheet = workbook.addWorksheet("Tasks");

  worksheet.columns = [
    { header: "Task Title", key: "title", width: 30 },
    { header: "Completed", key: "completed", width: 15 },
  ];

  tasks.forEach((task) => {
    worksheet.addRow({
      title: task.title,
      completed: task.completed ? "Yes" : "No",
    });
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=tasks.xlsx");

  await workbook.xlsx.write(res);
  res.end();
});

// ===== SERVER START =====
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
