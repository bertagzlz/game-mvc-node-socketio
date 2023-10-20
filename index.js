const WebSocketServer =require("socket.io");
const http = require("http");

const config=require('dotenv');
config.config(); // lee las var de entorno
const PORT = process.env.PORT || 4111;
const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost/socketsdb";

//const PORT =require("./config");
//import { PORT } from "./config";

// EXPRESS
const express = require("express");
const app = express();
//const cors=require("cors");
//app.use(cors());

// CARPETA PÚBLICA PASA JS, IMÁGENES
app.use(express.static('views'));
// USO EJS POR HABERLO USADO EN P2. motor plantillas similar a PUG
app.set("view engine", "ejs");
// BODY PARSING
app.use(express.urlencoded({ extended: false }));
const session = require('express-session');
const passport = require("passport");
const { loginCheck } = require("./auth/passport");
loginCheck(passport);
app.use(session({
    secret:'p3node',
    saveUninitialized: true,
    resave: true
}));
// MODULO PASSPORT para autenticar usuarios con datos locales
// npm install passport-local para uso con datos locales
app.use(passport.initialize());
app.use(passport.session());
// ENTRADA PRINCIPAL A LA APLICACIÓN
app.use("/", require("./controllers/entrada"));

//   C A R G A   D E   D A T O S   L O C A L E S   D O S   A R R A Y S
global.users=require("./data/data").users;
global.salas=require("./data/data").salas;
const Jugador = require("./models/Jugador.js");
const MiArray = require("./models/MiArray.js");

//   OBJETO DE CONEXIONES DE J U G A D O R E S
global.clients = {};

//   J U G A D O R   A C T U A L
global.esteJugador={};


//   P A R T I D A S
const Partida = require("./models/Partida.js");
global.partidas = new Map();
// array to Map
salas.forEach(sala=>{
    let value = new Partida(sala.id,sala.name,sala.balls,sala.jugadores,sala.estado)
    partidas.set(sala.id,value)
})

global.conectados = new MiArray([]); //[]; //new Map()
/* se usa al hacer login y ver quién no ha entrado al sistema.
Evitamos que un usuario entre dos veces.*/
global.noConectados=new Map();

//   L I B R E R Í A   S O C K E T I O
const server = http.createServer(app);
const httpServer = server.listen(PORT);
const io = new WebSocketServer(httpServer);
console.log("Server on http://localhost:", PORT);

//   B U C L E   D E   M E N S A J E S
//   C O N N E C T
io.on("connection", (connection) => {

    //   D I S C O N N E C T
    connection.on("disconnect", () => console.log(connection.id+ " disconnected!"))

    //   M E S S A G E   F R O M   J U G A D O R
    connection.on("message", async (message) => {
        const result = JSON.parse(message)
        //   U N   J U G A D O R   S E   C O N E C T A,   H I Z O   L O G I N
        if (result.method === "connect") {
            const idNuevoConectado = result.idJugador;
            console.log("connect del "+idNuevoConectado);
            //   INCREMENTO CONECTADOS
            conectados.getArray().push(idNuevoConectado);

            //   LOS CONECTADOS ENVÍAN A MÍ, QUE SOY NUEVO, SUS AVATARES Y QUEDAN EN CONECTADOS
            //   DE MÍ ENVIO MI AVATAR A TODOS LOS CONECTADOS Y QUEDAN EN CONECTADOS
            updateAvatarEnConectados(idNuevoConectado);
            //   DE LOS QUE ESTÁN JUGANDO R E C I B O   SUS AVATARES Y QUEDAN EN LAS SALAS
            getAvataresDeLosJugando(idNuevoConectado);
        }
        //   U N   J U G A D O R   W A N T   T O   J O I N
        if (result.method === "join") {
            const idJugador = result.idJugador;
            const idSala = Number(result.idSala);
            console.log("JOIN del "+ idJugador +" en sala "+idSala);
            let partida = partidas.get(idSala);
            if (partida.getNumeroJugadores() > 2) {
                console.log("sorry max players reached");
                return;
            }
            //   QUEDA EN   C O N E C T A D O S   Y   ENTRA ADEMÁS EN   P A R T I D A S
            partida.jugadores.push({
                "id": users[idJugador].id, //String(users[idJugador].id),
                // TODAS LAS SALAS IGUAL COLOR ROJO Y VERDE?
                "color": users[idJugador].color
            })
            // T O D O S   R E C I B E N   E L   A V A T A R   D E L   N U E V O JOINED
            updateMiAvatarAlResto(idJugador, idSala);
            borraMiAvatarEnRestoConectados(idJugador);
            //   S I   A D E M Á S   H A Y   D O S   E N   S A L A   S T A R T   T H E   G A M E
            if (partida.getNumeroJugadores() === 2) {
                // A   T O D O S   L O S   D E   L A   S A L A,   Y   A   É L
                // PONE SU COLOR Y DIBUJAR TABLERO
                const payLoad = {
                    "method": "joined",
                    "partida": partida,
                    "idJugador": -1 // "0"
                }
                partida.jugadores.forEach(j => {
                    payLoad.idJugador = j.id;
                    clients[j.id].connection.emit("message",JSON.stringify(payLoad));
                    //clients[j.id].connection.send(JSON.stringify(payLoad))
                })
            }
        }

        //   U N   J U G A D O R   J U E G A
        if (result.method === "play") {
            const idJugador = result.idJugador;
            const idSala = Number(result.idSala);
            const idBall = result.idBall;
            const color = result.color; // color bola

            const partida = partidas.get(idSala);
            //let state = partidas.get(idSala].state;
            let state = partida.estados;
            if (!state)
                state = {}
            // state es un objeto {1: "Red"}. state.1 ó state[1] vale "Red"
            state[idBall] = color; // state es un objeto {"Red", "Green"....} con keys {1, 2,...}
            // añade nuevo color
            partida.estados = state; //partida.setEstado(idBall,color);
            updateGameState();
            // A C T U A L I Z O   B A R R A S   D E   P R O G R E S O   A   T O D O S
            let index = 0;
            const isElement = (j) => j.id ===idJugador;
            index=partida.jugadores.findIndex(isElement);

            // a los dos jugadores pero a la misma barra, ojo
            partida.jugadores.forEach(j => {
                /*clients[j.id].connection.send(JSON.stringify({
                    "method": "newPoint", "idSala": idSala,"color":color,"index": index,
                }))*/
                clients[j.id].connection.emit("message", JSON.stringify({
                    "method": "newPoint", "idSala": idSala,"color":color,"index": index,
                }))
            })

            let points = 0;
            // recibo los puntos que tiene
            points=partida.getColoresPorJugador(color);
            // A   T O D O S LOS DE ESA PARTIDA:   idJugador   H A   G A N A D O
            if (points > 7) {
                console.log("Gana el jugador: " + idJugador);
                const payLoad = {
                    "method": "win",
                    "idJugador": idJugador,
                }
                partida.jugadores.forEach(j => {
                    //clients[j.id].connection.send(JSON.stringify(payLoad))
                    clients[j.id].connection.emit("message", JSON.stringify(payLoad))
                })
            }
        }
    }) //   F I N   O N   M E S S A G E   F R O M   J U G A D O R

    //   T O D O S   L O S   E N V Í O S   V A N   C O N   E S T A   C O N E X I Ó N
    const idJugador = esteJugador.id;
    clients[idJugador] = {
        "connection":  connection
    }
})

//   MÉTODOS   C O N E C T
// si tengo tres A B C y C acaba de conectarse:
// para B envía a A su avatar y A le envía a B el suyo
// para C envía a A su avatar y A le envía a C el suyo
function updateAvatarEnConectados(idNuevoConectado) {
    conectados.getArray().forEach(idResto=> {
        if (idNuevoConectado != idResto) {
            sendPayLoad("updateAvatarEnConectados",idResto,idNuevoConectado, false);
            sendPayLoad("updateAvatarEnConectados",idNuevoConectado,idResto, false);
        }
    });
}
// si tengo dos A y B que están en salas (jugando) y C acaba de conectarse:
// C debe recibir A en us sala
// C debe recibir B en su sala
function getAvataresDeLosJugando(idReceptor){
    for (const [key, value] of partidas) {
        const partida = partidas.get(key);
        partida.jugadores.forEach(e=> { // elemento del array
            const payLoad = {
                "method": "getAvataresDeLosJugando",
                "idJugador": e.id,
                "idSala": key,
            }
            clients[idReceptor].connection.emit("message", JSON.stringify(payLoad))
            //clients[idReceptor].connection.send(JSON.stringify(payLoad))
        });
    }
}
// entra a jugar a la sala, sale de su barra de conectados don Drag&drop y el resto de usuarios
// debe saberlo para borrarlo también

//   MÉTODOS   J O I N
// entra a join a la sala, las salas de los otros deben tener este avatar
function updateMiAvatarAlResto(idJugador,idSala) {
    conectados.getArray().forEach(idContrario=> {
        if (idJugador != idContrario) {
            // el 1 es el idJugador, se lo tiene que decir al 0
            const payLoad = {
                "method": "updateMiAvatarAlResto",
                "idJugador": idJugador,
                "idSala": idSala,
            }
            // al contrario le pongo mi avatar en la sala
            const s="message";
            clients[idContrario].connection.emit(s, JSON.stringify(payLoad))
            //clients[idContrario].connection.send(JSON.stringify(payLoad))
            console.log("updateAvatar mio en el contrario " + idContrario);
        }
    });
}
// entra a join a la sala, sale de su barra de conectados con Drag&drop pero el resto de usuarios
// debe saberlo para borrarlo también
function borraMiAvatarEnRestoConectados(idJugador) {
    conectados.getArray().forEach(idContrario=> {
        if (idJugador != idContrario) {
            sendPayLoad("borraMiAvatarEnRestoConectados",idContrario,idJugador, false);
        }
    });
}

//   MÉTODOS   G L O B A L E S   D E   A Y U D A
function sendPayLoad(method, who, what,draggable) {
    const payLoad = { "method": method, "idJugador": what, "draggable":draggable }
    //clients[who].connection.send(JSON.stringify(payLoad))
    clients[who].connection.emit("message", JSON.stringify(payLoad))
    console.log(method + " "+who);
}

// A   T O D O S   L O S   U S U A R I O S   E N V I A M O S   E L   J U E G O   C O M P L E T O
// CADA 0,5 SEG.
function updateGameState(){
    // { "idSala", fasdfsf }
    for (const [key, value] of partidas) {
        const partida = partidas.get(key)
        if (partida.estados) {
        const payLoad = {
            "method": "update",
            "estados": partida.estados
        }
        /*partida.jugadores.forEach(j => {
            clients[j.id].connection.send(JSON.stringify(payLoad))
        })*/

        io.emit("message", JSON.stringify(payLoad))
                    }
    }
    setTimeout(updateGameState, 500);
}

// this runs after the server successfully starts:
/*function serverStart() {
    console.log('Server listening on port ' + PORT);
}
var PORT = process.env.PORT || 4111;
app.listen(PORT, serverStart());
*/

