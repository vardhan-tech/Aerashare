const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static("public")); // serve client files from ./public

const server = http.createServer(app);
const io = new Server(server);

// In-memory map: otp -> { uploaderSocketId, createdAt }
const otpMap = new Map();

// Generate unique 4-digit OTP (string)
function genOTP() {
  let otp;
  do {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
  } while (otpMap.has(otp));
  return otp;
}

// Clean up OTPs older than e.g. 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [otp, info] of otpMap) {
    if (now - info.createdAt > 5 * 60 * 1000) otpMap.delete(otp);
  }
}, 60 * 1000);

io.on("connection", (socket) => {
  console.log("conn:", socket.id);

  // Uploader asks for an OTP (creates room)
  socket.on("create-room", () => {
    const otp = genOTP();
    otpMap.set(otp, { uploaderSocketId: socket.id, createdAt: Date.now() });
    socket.join(otp);
    socket.emit("room-created", { otp });
    console.log("room created", otp, "by", socket.id);
  });

  // Receiver tries to join
  socket.on("join-room", ({ otp }) => {
    if (!otpMap.has(otp)) {
      socket.emit("join-failed", { reason: "Invalid or expired OTP" });
      return;
    }
    // Add receiver to the room
    socket.join(otp);
    // notify both sides
    io.to(otp).emit("peer-joined", { message: "A peer joined the room", room: otp });
    socket.emit("join-success", { room: otp });
    console.log(socket.id, "joined room", otp);
  });

  // Relay file-meta from uploader to room
  socket.on("file-meta", ({ room, name, size, type, chunkSize }) => {
    // Forward meta to all in room except sender
    socket.to(room).emit("file-meta", { name, size, type, chunkSize });
  });

  // Relay file-chunk (binary) to room
  socket.on("file-chunk", ({ room, chunk }) => {
    // chunk is expected to be an ArrayBuffer or Buffer; socket.io supports binary
    socket.to(room).emit("file-chunk", { chunk });
  });

  // Signal end of file
  socket.on("file-end", ({ room }) => {
    socket.to(room).emit("file-end");
    console.log("file end for room", room);
  });

  // Cleanup: if uploader disconnects, remove otp mapping
  socket.on("disconnect", () => {
    for (const [otp, info] of otpMap) {
      if (info.uploaderSocketId === socket.id) {
        otpMap.delete(otp);
        // inform room that uploader disconnected
        io.to(otp).emit("uploader-disconnected");
        console.log("Uploader disconnected; removed OTP", otp);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
