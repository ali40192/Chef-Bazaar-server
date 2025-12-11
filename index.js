const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

///midleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fyk0nds.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("chef_bazaar_db");
    const mealsCollection = db.collection("meals");

    ////meals api
    ////1.get all meals
    app.get("/meals", async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });
    ///////1.2.get all meals for all meals page
    app.get("/allmeals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    ////2.get single meal
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    ////3.post a meal
    app.post("/meals", async (req, res) => {
      const meal = req.body;
      const result = await mealsCollection.insertOne(meal);
      res.send(result);
    });
    ////4.update a meal
    // app.put("/meals/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const meal = req.body;
    //   const options = { upsert: true };
    //   const updatedMeal = {
    //     $set: {
    //       name: meal.name,
    //       description: meal.description,
    //     }
    //   }
    // })

    ///delete a meal
    // app.delete("/meals/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await mealsCollection.deleteOne(query);
    //   res.send(result);
    // });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My Chef-Bazaar");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
