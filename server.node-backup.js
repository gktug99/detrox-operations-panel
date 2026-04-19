const http = require("http");
const { URL } = require("url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 3000;

let nextId = 3;
let products = [
  { id: 1, name: "Laptop", price: 35000, inStock: true },
  { id: 2, name: "Mouse", price: 900, inStock: true }
];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;

      if (data.length > 1e6) {
        reject(new Error("Request body cok buyuk"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Gecersiz JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function validateProduct(body) {
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return "name alani zorunludur";
  }

  if (typeof body.price !== "number" || Number.isNaN(body.price) || body.price < 0) {
    return "price alani sifirdan buyuk veya esit bir number olmalidir";
  }

  if (body.inStock !== undefined && typeof body.inStock !== "boolean") {
    return "inStock alani boolean olmalidir";
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathParts = url.pathname.split("/").filter(Boolean);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/products") {
      sendJson(res, 200, products);
      return;
    }

    if (req.method === "POST" && url.pathname === "/products") {
      const body = await readJsonBody(req);
      const validationError = validateProduct(body);

      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const newProduct = {
        id: nextId++,
        name: body.name.trim(),
        price: body.price,
        inStock: body.inStock ?? true
      };

      products.push(newProduct);
      sendJson(res, 201, newProduct);
      return;
    }

    if (pathParts[0] === "products" && pathParts[1]) {
      const id = Number(pathParts[1]);
      const index = products.findIndex((product) => product.id === id);

      if (!Number.isInteger(id)) {
        sendJson(res, 400, { error: "Gecersiz product id" });
        return;
      }

      if (req.method === "GET") {
        if (index === -1) {
          sendJson(res, 404, { error: "Product bulunamadi" });
          return;
        }

        sendJson(res, 200, products[index]);
        return;
      }

      if (req.method === "PUT") {
        if (index === -1) {
          sendJson(res, 404, { error: "Product bulunamadi" });
          return;
        }

        const body = await readJsonBody(req);
        const validationError = validateProduct(body);

        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        const updatedProduct = {
          id,
          name: body.name.trim(),
          price: body.price,
          inStock: body.inStock ?? products[index].inStock
        };

        products[index] = updatedProduct;
        sendJson(res, 200, updatedProduct);
        return;
      }

      if (req.method === "DELETE") {
        if (index === -1) {
          sendJson(res, 404, { error: "Product bulunamadi" });
          return;
        }

        const deletedProduct = products[index];
        products = products.filter((product) => product.id !== id);
        sendJson(res, 200, deletedProduct);
        return;
      }
    }

    sendJson(res, 404, { error: "Route bulunamadi" });
  } catch (error) {
    const statusCode = error.message === "Gecersiz JSON body" ? 400 : 500;
    sendJson(res, statusCode, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server http://${HOST}:${PORT} adresinde calisiyor`);
});
