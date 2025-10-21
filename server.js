const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

// Trust proxy headers for deployed servers
app.set('trust proxy', true);

// Visitor tracking
let uniqueIPs = new Set();
let visitorCount = 0;

app.use((req, res, next) => {
  const userIP = req.ip; // Express automatically uses X-Forwarded-For if trust proxy is true

  if (!uniqueIPs.has(userIP)) {
    uniqueIPs.add(userIP);
    visitorCount++;
    console.log(`👤 New unique visitor detected (IP: ${userIP})`);
    console.log(`🌍 Total unique visitors: ${visitorCount}`);
  } else {
    console.log(`🔁 Returning visitor from IP: ${userIP}`);
  }

  next();
});

// Optional endpoint to fetch visitor count
app.get("/visitors", (req, res) => {
  res.json({ totalVisitors: visitorCount });
});

// Serve frontend files
app.use(express.static("public"));

// ========== File sharing / Socket.IO ==========
const server = http.createServer(app);
const io = new Server(server);

const otpMap = new Map();

function genOTP() {
  let otp;
  do {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
  } while (otpMap.has(otp));
  return otp;
}

setInterval(() => {
  const now = Date.now();
  for (const [otp, info] of otpMap) {
    if (now - info.createdAt > 5 * 60 * 1000) otpMap.delete(otp);
  }
}, 60 * 1000);

io.on("connection", (socket) => {
  console.log("conn:", socket.id);

  socket.on("create-room", () => {
    const otp = genOTP();
    otpMap.set(otp, { uploaderSocketId: socket.id, createdAt: Date.now() });
    socket.join(otp);
    socket.emit("room-created", { otp });
    console.log("room created", otp, "by", socket.id);
  });

  socket.on("join-room", ({ otp }) => {
    if (!otpMap.has(otp)) {
      socket.emit("join-failed", { reason: "Invalid or expired OTP" });
      return;
    }
    socket.join(otp);
    io.to(otp).emit("peer-joined", { message: "A peer joined the room", room: otp });
    socket.emit("join-success", { room: otp });
    console.log(socket.id, "joined room", otp);
  });

  socket.on("file-meta", ({ room, name, size, type, chunkSize }) => {
    socket.to(room).emit("file-meta", { name, size, type, chunkSize });
  });

  socket.on("file-chunk", ({ room, chunk }) => {
    socket.to(room).emit("file-chunk", { chunk });
  });

  socket.on("file-end", ({ room }) => {
    socket.to(room).emit("file-end");
    console.log("file end for room", room);
  });

  socket.on("disconnect", () => {
    for (const [otp, info] of otpMap) {
      if (info.uploaderSocketId === socket.id) {
        otpMap.delete(otp);
        io.to(otp).emit("uploader-disconnected");
        console.log("Uploader disconnected; removed OTP", otp);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
