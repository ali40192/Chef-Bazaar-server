const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;

const crypto = require("crypto");
const { log } = require("console");

const admin = require("firebase-admin");

// Initialize Firebase Admin (replace with your service account key path or env vars)
const serviceAccount = require("./chefbazarfirebaseadminSdk.json"); // Download from Firebase Console
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  return `LCB-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

///midleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fyk0nds.mongodb.net/?appName=Cluster0`;

////jwt verify
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
    next();
  } catch (err) {
    // console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

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
    const orderCollection = db.collection("order_collection");
    const paymentCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const chefCollection = db.collection("chef-requests");
    const adminRequestCollection = db.collection("admin-requests");
    const reviewCollection = db.collection("reviews");
    const favouriteCollection = db.collection("favourite-meals");

    /////varify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user && user.role !== "admin") {
        return res
          .status(403)
          .send({ message: "only Admin can access", role: user?.role });
      }
      next();
    };

    ////verify chef
    const verifyChef = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user && user.role !== "chef") {
        return res
          .status(403)
          .send({ message: "only chef can access", role: user?.role });
      }
      next();
    };

    ////meals api
    ////1.get 6 meals for home page
    app.get("/meals", async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });

    /////2.get  all meals page ,sort and pagination  add kora
    app.get("/allmeals", async (req, res) => {
      try {
        const {
          sort = "price",
          order = "desc",
          page = 1,
          limit = 10,
        } = req.query;

        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);
        const skip = (pageNumber - 1) * limitNumber;

        const allowedSortFields = ["price", "rating", "createdAt"];
        const sortField = allowedSortFields.includes(sort) ? sort : "price";

        const sortOptions = {};
        sortOptions[sortField] = order === "asc" ? 1 : -1;

        const meals = await mealsCollection
          .find()
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .toArray();

        const totalMeals = await mealsCollection.countDocuments();

        res.send({
          meals,
          totalMeals,
          currentPage: pageNumber,
          totalPages: Math.ceil(totalMeals / limitNumber),
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load meals" });
      }
    });

    ////get  meals by chef hoyto use hoi nai
    app.get("/mymeals", verifyJWT, verifyChef, async (req, res) => {
      const email = req.tokenEmail;
      const result = mealsCollection.find({ userEmail: email });
      const meals = await result.toArray();
      res.send(meals);
    });

    //////get my meals by id
    app.get("/mymeals/:id", verifyJWT, verifyChef, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const meal = await mealsCollection.findOne(query);
      res.send(meal);
    });

    //////update a meal
    app.patch("/mymeals/:id", verifyJWT, verifyChef, async (req, res) => {
      const id = req.params.id;
      const newDet = req.body;
      console.log(newDet);

      const email = req.tokenEmail;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          foodName: newDet.foodName,
          chefName: newDet.chefName,
          foodImage: newDet.foodImage,
          price: newDet.price,
          rating: newDet.rating,
          ingredients: newDet.ingredients,
          estimatedDeliveryTime: newDet.estimatedDeliveryTime,
          chefExperience: newDet.chefExperience,

          userEmail: email,
        },
      };
      const result = await mealsCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    //////delete a meal
    app.delete("/mymeals/:id", verifyJWT, verifyChef, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.deleteOne(query);
      res.send(result);
    });

    ////2.get single meal
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    ////3.post a meal || create a meal || add a meal
    app.post("/meals", verifyJWT, verifyChef, async (req, res) => {
      const meal = req.body;
      const result = await mealsCollection.insertOne(meal);
      res.send(result);
    });

    /////create my orders
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });

    ////get my orders
    app.get("/orders", verifyJWT, async (req, res) => {
      const result = orderCollection.find({ userEmail: req.tokenEmail });
      const orders = await result.toArray();
      res.send(orders);
    });

    ///create payment
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.mealName,
              },
              unit_amount: paymentInfo.price * 100,
            },
            quantity: paymentInfo.quantity,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: "payment",
        metadata: {
          foodId: paymentInfo.foodId,
          orderId: paymentInfo.orderId,
          quantity: paymentInfo.quantity,
        },
        success_url: `http://localhost:5173/dashboard/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:5173/meals/${paymentInfo?.foodId}`,
      });

      // Update the order (convert id to ObjectId)
      const orderUpdateResult = await orderCollection.updateOne(
        { _id: new ObjectId(paymentInfo.orderId) },
        { $set: { checkoutSessionId: session.id, paymentStatus: "pending" } }
      );
      console.log("order updateResult:", orderUpdateResult);
      res.send({ url: session.url, orderUpdateResult });
    });

    ////payment success//
    app.patch("/success-payment", async (req, res) => {
      const sessionId = req.body.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);

      if (session.payment_status === "paid") {
        // Generate trackingId once
        const trackingId = generateTrackingId();
        // console.log("Generated trackingId:", trackingId);

        // Update orderCollection
        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",

            transectionId: session.payment_intent,
            trackingId: trackingId,
          },
        };
        const updateResult = await orderCollection.updateOne(query, updateDoc);
        console.log("orderCollection.updateOne result:", updateResult);

        // Save payment history to paymentCollection
        const meal = await mealsCollection.findOne({
          _id: new ObjectId(session.metadata.foodId),
        });
        const paymentExist = await paymentCollection.findOne({
          transectionId: session.payment_intent,
        });
        if (meal && !paymentExist) {
          const orderInfo = {
            price: session.amount_total / 100,
            currency: session.currency,
            customer_email: session.customer_email,
            foodId: session.metadata.foodId,
            orderId: session.metadata.orderId,
            transectionId: session.payment_intent,
            paymentStatus: session.payment_status,
            status: "pending",
            chefId: meal.chefId,
            mealName: meal.foodName,
            quantity: session.metadata.quantity,
            paidAt: new Date(),
            trackingId: trackingId,
          };
          const insertResult = await paymentCollection.insertOne(orderInfo);
          return res.send({ updateResult, insertResult });
        }

        return res.send(updateResult);
      }

      res.send({ success: false });
    });

    ////user collection create or update //// all kinds of user here
    app.post("/users", async (req, res) => {
      const user = req.body;

      user.created_at = new Date().toISOString();
      user.last_loggedIn = new Date().toISOString();
      user.role = "user";
      user.status = "active";
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        const result = await usersCollection.updateOne(query, {
          $set: { last_loggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    /////get user role   ///
    app.get("/users/role", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    ///get user data by email
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const userDetails = await usersCollection.findOne(query);
      res.send(userDetails);
    });

    ////become a chef request

    app.post("/become-chef", verifyJWT, async (req, res) => {
      const { userDetails } = req.body;

      const userName = userDetails.name;
      const email = req.tokenEmail;
      const requestType = "chef";
      const requestStatus = "pending";

      const alreadyExist = await chefCollection.findOne({
        userEmail: email,
      });
      if (alreadyExist)
        return res.status(409).send({ message: "already exist" });

      const result = await chefCollection.insertOne({
        userName,
        userEmail: email,
        requestType,
        requestStatus,
      });
      res.send(result);
    });

    app.get("/chef-requests", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await chefCollection.find().toArray();

      res.send(result);
    });

    ////update user role
    app.patch("/update-role", verifyJWT, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      // console.log(email, role);
      req.body.chefId = Math.floor(1000 + Math.random() * 9000);

      /////////usercollection a update koreche
      const updateFields = { role };
      if (role === "chef") {
        updateFields.chefId = req.body.chefId;
      }
      const result = await usersCollection.updateOne(
        { email },
        { $set: updateFields }
      );

      ////jodi chef collection a exsist kore delate korte hobe
      await chefCollection.deleteOne({ userEmail: email });
      res.send(result);
    });

    ////////become admin request
    app.post("/become-admin", verifyJWT, async (req, res) => {
      const { userDetails } = req.body;

      const userName = userDetails.name;
      const email = req.tokenEmail;
      const requestType = "admin";
      const requestStatus = "pending";

      const alreadyExist = await adminRequestCollection.findOne({
        userEmail: email,
      });
      if (alreadyExist)
        return res.status(409).send({ message: "already exist" });

      const result = await adminRequestCollection.insertOne({
        userName,
        userEmail: email,
        requestType,
        requestStatus,
      });
      res.send(result);
    });

    ///////get all admin request
    app.get("/admin-requests", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await adminRequestCollection.find().toArray();
      res.send(result);
    });

    //////update admin role
    app.patch("/become-admin", verifyJWT, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;

      const update = { role };
      const result = await usersCollection.updateOne(
        { email },
        { $set: update }
      );

      ////jodi admin collection a exsist kore delate korte hobe
      await adminRequestCollection.deleteOne({ userEmail: email });
      res.send(result);
    });

    ////////if reject
    app.patch(
      "/become-rejectChef",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { email } = req.body;
        console.log(email);

        const newStatus = "rejected";
        const update = {
          requestStatus: newStatus,
        };

        const result = await chefCollection.updateOne(
          {
            userEmail: email,
          },
          { $set: update }
        );

        res.send(result);
      }
    );

    ////admin  reject

    app.patch(
      "/become-rejectAdmin",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { email } = req.body;

        const newStatus = "rejected";
        const update = {
          requestStatus: newStatus,
        };

        const result = await adminRequestCollection.updateOne(
          {
            userEmail: email,
          },
          { $set: update }
        );

        res.send(result);
      }
    );

    ////make fraud
    app.patch("/become-fraud", verifyJWT, verifyAdmin, async (req, res) => {
      const { email } = req.body;

      const newStatus = "fraud";
      const update = {
        status: newStatus,
      };

      const result = await usersCollection.updateOne(
        {
          email: email,
        },
        { $set: update }
      );

      res.send(result);
    });

    /////get all users
    app.get("/all-users", verifyJWT, verifyAdmin, async (req, res) => {
      const adminEmail = req.tokenEmail;
      const result = await usersCollection
        .find({ email: { $ne: adminEmail } })
        .toArray();

      res.send(result);
    });

    /////create || give review by users
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });
    ///////get reviews spicipic meal by id

    app.get("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      // console.log(id);

      const result = await reviewCollection.find({ foodId: id }).toArray();
      res.send(result);
    });

    ////get all reviews
    app.get("/allreviews", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await reviewCollection
        .find({ reviewerEmail: email })
        .toArray();
      res.send(result);
    });

    /////update review by users
    app.patch("/reviews/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const email = req.tokenEmail;
      const query = { foodId: id, reviewerEmail: email };
      const newReview = req.body;
      // console.log({ rating: newReview.rating, comment: newReview.comment });

      const options = { upsert: true };
      const updatedReview = {
        $set: {
          rating: newReview.rating,
          comment: newReview.comment,
        },
      };

      const result = await reviewCollection.updateOne(
        query,
        updatedReview,
        options
      );
      res.send(result);
    });

    ///////delete review by users
    app.delete("/reviews/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      const email = req.tokenEmail;
      const query = { foodId: id, reviewerEmail: email };
      const result = await reviewCollection.deleteOne(query);
      res.send(result);
    });

    //////favourite meal by users
    app.post("/favourite-meal", async (req, res) => {
      const favourite = req.body;

      console.log(favourite);

      const alreadyFavourite = await favouriteCollection.findOne({
        mealId: favourite.mealId,
        userEmail: favourite.userEmail,
      });

      if (alreadyFavourite) {
        const result = await favouriteCollection.updateOne(
          { mealId: favourite.mealId },
          { $set: { addedTime: new Date().toLocaleString() } }
        );
        return res.send(result);
      }

      const result = await favouriteCollection.insertOne(favourite);

      res.send(result);
    });

    ///////get favourite meal by users
    app.get("/favourite-meal", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const query = { userEmail: email };
      const cursor = favouriteCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    /////delete a favourite collection

    app.delete("/favourite-meal/:id", async (req, res) => {
      const id = req.params.id;
      const query = { mealId: id };
      const result = await favouriteCollection.deleteOne(query);
      res.send(result);
    });

    //////get all my created meal
    app.get("/my-meal", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const query = { email: email };
      const cursor = mealCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    ////get my meal order req
    app.get("/my-meal-order/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      console.log(id);

      const query = { chefId: id };
      const cursor = orderCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    /////////update order status
    app.patch("/update-order-status/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);

      const status = req.body;

      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          orderStatus: status.status,
        },
      };
      const result = await orderCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
    });

    // status
    app.get("/users/status", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ status: result?.status });
    });

    ////chefId//
    app.get("/users/chefId", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ chefId: result?.chefId });
    });

    /////three in one
    app.get("/dashboard-statistics", async (req, res) => {
      try {
        const totalPayment = await paymentCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$price" },
              },
            },
          ])
          .toArray();

        const totalUsers = await usersCollection
          .aggregate([{ $count: "totalUsers" }])
          .toArray();

        const orderStatusCounts = await orderCollection
          .aggregate([
            {
              $group: {
                _id: "$orderStatus",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const statusMap = {};
        orderStatusCounts.forEach((item) => {
          statusMap[item._id] = item.count;
        });

        res.send({
          totalAmount: totalPayment[0]?.totalAmount || 0,
          totalUsers: totalUsers[0]?.totalUsers || 0,
          pendingOrders: statusMap["Pending"] || 0,
          deliveredOrders: statusMap["delivered"] || 0,
          cancelledOrders: statusMap["cancelled"] || 0,
        });
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });

    //////get all rewiew for home
    app.get("/reviewhome", async (req, res) => {
      const result = await reviewCollection.find({}).toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My Chef-Bazaar");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
