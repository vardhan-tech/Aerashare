const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

// ========== Visitor Tracking Middleware ==========
let uniqueIPs = new Set();
let visitorCount = 0;

app.use((req, res, next) => {
  const userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!uniqueIPs.has(userIP)) {
    uniqueIPs.add(userIP);
    visitorCount++;
    console.log(`👤 New unique visitor detected (IP: ${userIP})`);
    console.log(`🌍 Total unique visitors: ${visitorCount}`);
  } else {
    console.log(`🔁 Returning visitor from IP: ${userIP}`);
  }

  next(); // continue to static files or other routes
});

// Serve static files (frontend)
app.use(express.static("public"));

// ========== File Sharing / OTP Logic ==========
const server = http.createServer(app);
const io = new Server(server);

const otpMap = new Map();

// Generate unique 4-digit OTP
function genOTP() {
  let otp;
  do {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
  } while (otpMap.has(otp));
  return otp;
}

// Cleanup old OTPs every minute (older than 5 minutes)
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
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
