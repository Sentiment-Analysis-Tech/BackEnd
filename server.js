require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const elasticsearch = require('elasticsearch');
const router = require("./routes");

const app = express();
const port = process.env.PORT || 8080;

const elasticClient = new elasticsearch.Client({
  host: process.env.ELASTICSEARCH_URL,
  log: "trace",
});

elasticClient.ping(
  {
    requestTimeout: 30000,
  },
  function (error) {
    if (error) {
      console.error("elasticsearch cluster is down!");
    } else {
      console.log("All is well");
    }
  }
);

app.set("trust proxy", true);
console.log("Express is configured to trust the 'X-Forwarded-For' header");

async function run() {
  try {
    // Ensure Elasticsearch is connected
    await elasticClient.ping();
    console.log("Connected to Elasticsearch");

    // Updated CORS configuration
    app.use(
      cors({
        origin: function (origin, callback) {
          const allowedOrigins = [
            "http://localhost:3000",
            "http://localhost:9000",
            "http://youtubeanalysistech.com",
            "http://www.youtubeanalysistech.com",
          ];
          // Check if the origin is in your list of allowed origins or a Chrome extension
          if (
            !origin ||
            allowedOrigins.includes(origin) ||
            (origin && origin.startsWith("chrome-extension://"))
          ) {
            callback(null, true); // Allow the request
          } else {
            console.log("Blocked by CORS:", origin); // Optional: log for debugging
            callback(new Error("Not allowed by CORS")); // Block the request
          }
        },
        credentials: true, // Allow credentials like cookies
      })
    );

    app.use((req, res, next) => {
      req.elasticClient = elasticClient;
      next();
    });
    app.use(express.json({ limit: "20mb" }));
    app.use(express.urlencoded({ limit: "20mb", extended: true }));
    app.use(cookieParser());
    app.use("/api", router);

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.log(
      "Error starting the server or connecting to Elasticsearch:",
      error.message
    );
    process.exit(1);
  }
}
run().catch(console.error);
