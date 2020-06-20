const express = require("express")();
const mongoose = require("mongoose");
const server = require("http").createServer(express);
const io = require("socket.io")(server);
const axios = require("axios").default;
require("dotenv").config();
const handlebars = require("express-handlebars");
const chatServer = require("express")();
const chatHttp = require("http").createServer(chatServer);
const chatApp = require("socket.io")(chatHttp);
const User = require("./models/userModel");

const playersPerRoom = 3;
let rooms = [null];

const clientID = process.env.GITHUB_CLIENT;
const clientSecret = process.env.GITHUB_SECRET;

io.on("connection", (socket) => {
  let firstPlayer = "";
  let roomNumber = -1;
  if (rooms[rooms.length - 1] == null) {
    if (rooms.length < 2 || rooms[rooms.length - 2].length == playersPerRoom) {
      rooms[rooms.length - 1] = [];
      rooms[rooms.length - 1].push([socket.id, false]);
      firstPlayer = socket.id;
      roomNumber = rooms.length - 1;
      io.sockets.to(firstPlayer).emit("firstPlayer");
    } else {
      rooms[rooms.length - 2].push([socket.id, false]);
      firstPlayer = rooms[rooms.length - 2][0][0];
      roomNumber = rooms.length - 2;
    }
  } else if (rooms[rooms.length - 1].length < playersPerRoom - 1) {
    rooms[rooms.length - 1].push([socket.id, false]);
    firstPlayer = rooms[rooms.length - 1][0][0];
    socket.join(firstPlayer);
    roomNumber = rooms.length - 1;
  } else if (rooms[rooms.length - 1].length == playersPerRoom - 1) {
    rooms[rooms.length - 1].push([socket.id, false]);
    firstPlayer = rooms[rooms.length - 1][0][0];
    socket.join(firstPlayer);
    roomNumber = rooms.length - 1;
    rooms.push(null);
  }

  socket.on("newPlayerJoined", function (locationInfo) {
    socket.broadcast
      .to(firstPlayer)
      .emit("newPlayerJoined", locationInfo, socket.id);
    console.log(rooms);
    if (rooms[roomNumber].length == playersPerRoom) {
      console.log(rooms[roomNumber].length, playersPerRoom);
      io.sockets.to(firstPlayer).emit("roomFull");
      console.log(rooms);
    }
  });

  socket.on("chatMessage", function (message) {
    socket.broadcast.to(firstPlayer).emit("chatMessage", message);
  });

  socket.on("extrasData", function (data) {
    socket.broadcast.to(firstPlayer).emit("extrasData", data);
  });

  socket.on("roomPlayerDetails", function (locationInfo) {
    socket.broadcast
      .to(firstPlayer)
      .emit("roomPlayerDetails", locationInfo, socket.id);
  });
  socket.on("playerReady", function () {
    let index = -1;
    for (let j = 0; j < rooms[roomNumber].length; j++) {
      if (rooms[roomNumber][j][0] == socket.id) {
        index = j;
      }
    }
    console.log(index);
    rooms[roomNumber][index][1] = true;
    let flag = true;
    for (let i = 0; i < rooms[roomNumber].length; i++) {
      if (rooms[roomNumber][i][1] == false) {
        flag = false;
      }
    }
    if (flag) {
      io.sockets.to(firstPlayer).emit("startGame");
    }
  });

  socket.on("playerID", async function (id) {
    console.log(id);
    await User.findOneAndUpdate(
      { _id: id.slice(3, id.length - 1) },
      { $inc: { gamesPlayed: 1 } },
      function (error, result) {
        console.log(result);
      }
    );
  });

  socket.on("playerWon", async function (id) {
    await User.findOneAndUpdate(
      { _id: id.slice(3, id.length - 1) },
      { $inc: { wins: 1 } },
      function (error, result) {
        console.log(result);
      }
    );
  });

  socket.on("playerMoved", function (moveMade) {
    socket.broadcast.to(firstPlayer).emit("playerMoved", moveMade, socket.id);
  });
  socket.on("disconnect", function () {
    if (rooms[roomNumber] != null && rooms[roomNumber].length == 2) {
      io.to(firstPlayer).emit("youWon");
    }
    rooms[roomNumber] = rooms[roomNumber].filter(function (value) {
      return value[0] != socket.id;
    });
    if (rooms[roomNumber].length == 0) {
      rooms.splice(roomNumber, 1);
      if (rooms[rooms.length - 1] != null || rooms.length == 0) {
        rooms.push(null);
      }
    }
    console.log(rooms.length, rooms);
    console.log(socket.id + " disconnected");
  });
});

const chat = chatApp.of("/chat");

chat.on("connection", (socket) => {
  console.log(socket.id + " connected to chat room");
  socket.broadcast.emit("new user", socket.id.slice(6));
  socket.on("chat message", (message) => {
    console.log(message);
    socket.broadcast.emit("chat message", message, socket.id.slice(6));
  });
  socket.on("typing", () => {
    socket.broadcast.emit("typing", socket.id.slice(6));
  });
  socket.on("disconnect", () => {
    console.log(socket.id + " disconnected from chat room");
    socket.broadcast.emit("playerLeft", socket.id);
  });
});

// Game server stuff

express.use(require("cookie-parser")());
express.set("view engine", "hbs");
express.engine(
  "hbs",
  handlebars({
    layoutsDir: __dirname + "/views/layouts",
    extname: "hbs",
    defaultLayout: "index",
  })
);

express.use(
  require("express").static(require("path").join(__dirname, "public"))
);

express.get("/", (req, res) => {
  let token = req.cookies["login"];
  if (!token) {
    res.render("main");
  } else {
    res.redirect("/profile");
  }
});

express.get("/game", (req, res) => {
    res.render("game");
});

express.get("/github-login", (req, res) => {
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${clientID}`
  );
});

express.get("/profile", async (req, res) => {
  if (req.query.provider == "github") {
    try {
      const body = {
        client_id: clientID,
        client_secret: clientSecret,
        code: req.query.code,
      };
      const opts = {
        headers: {
          accept: "application/json",
        },
      };
      const accessToken = await (
        await axios.post(
          "https://github.com/login/oauth/access_token",
          body,
          opts
        )
      ).data.access_token;

      const config = {
        method: "get",
        url: "https://api.github.com/user",
        headers: { Authorization: `token ${accessToken}` },
      };

      const userData = await (await axios(config)).data;

      const oldUser = await User.findOne({ userName: userData.login }).lean();
      if (oldUser) {
        console.log("Old user!");
        console.log(oldUser);
        res.cookie("login", oldUser._id, {
          maxAge: 86400000,
        });
        res.render("profile", {
          userName: oldUser.userName,
          gamesPlayed: oldUser.gamesPlayed,
          wins:
            oldUser.gamesPlayed === 0
              ? 0
              : (oldUser.wins / oldUser.gamesPlayed) * 100,
          dateJoined: `${oldUser.dateJoined.getDate()}/${
            oldUser.dateJoined.getMonth() + 1
          }/${oldUser.dateJoined.getFullYear()}`,
        });
      } else {
        const user = new User({
          userName: userData.login,
        });

        const DBuser = await user.save();
        res.cookie("login", DBuser._id, {
          maxAge: 86400000,
        });
        console.log("Saved to DB");
        console.log(DBuser);
        // const NewUser = { userName: DBuser.userName, wins: DBuser.wins };

        res.render("profile", {
          userName: DBuser.userName,
          gamesPlayed: DBuser.gamesPlayed,
          wins:
            DBuser.gamesPlayed === 0
              ? 0
              : (DBuser.wins / DBuser.gamesPlayed) * 100,
          dateJoined: `${DBuser.dateJoined.getDate()}/${
            DBuser.dateJoined.getMonth() + 1
          }/${DBuser.dateJoined.getFullYear()}`,
        });
      }
    } catch (error) {
      console.log("ERROR!!");
      console.log(error);
    }
  } else {
    const token = req.cookies["login"];
    const DBuser = await User.findById(token).lean();
    console.log(DBuser);
    // console.log(DBuser.dateJoined.getFullYear());
    res.cookie("login", token, { maxAge: 86400000 });
    res.render("profile", {
      userName: DBuser.userName,
      gamesPlayed: DBuser.gamesPlayed,
      wins:
        DBuser.gamesPlayed === 0 ? 0 : (DBuser.wins / DBuser.gamesPlayed) * 100,
      dateJoined: `${DBuser.dateJoined.getDate()}/${
        DBuser.dateJoined.getMonth() + 1
      }/${DBuser.dateJoined.getFullYear()}`,
    });
  }
});

// Chatserver stuff

chatServer.set("view engine", "hbs");
chatServer.engine(
  "hbs",
  handlebars({
    layoutsDir: __dirname + "/views/layouts",
    extname: "hbs",
    defaultLayout: "chat",
  })
);

chatServer.use(
  require("express").static(require("path").join(__dirname, "public"))
);

chatServer.get("/chat", (req, res) => {
  res.render("chat");
});

mongoose
  .connect(process.env.DB_CONNECTION, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(console.log("Connected to DB"))
  .catch((err) => console.log(err));

chatHttp.listen(4000, () => {
  console.log("Chat server listening on port " + 4000);
});

server.listen(3000, () => {
  console.log("Server listening on port " + 3000);
});
