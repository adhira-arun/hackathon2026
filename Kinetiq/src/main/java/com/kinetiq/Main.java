
package com.kinetiq;

import javafx.application.Application;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;
import javafx.scene.shape.CubicCurve;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.stage.Stage;

public class Main extends Application {

    private static final Color IVORY = Color.web("#F5F1E9");
    private static final Color TAUPE = Color.web("#A39788");
    private static final Color DARK = Color.web("#49463F");
    private static final Color SAND = Color.web("#C8BBA9");
    private static final Color WHITE = Color.web("#FFFFFF");

    private Stage primaryStage;

    @Override
    public void start(Stage stage) {
        primaryStage = stage;
        showLogin();
    }

    // LOGIN SCREEN
    private void showLogin() {

        BorderPane root = new BorderPane();
        root.setBackground(new Background(
                new BackgroundFill(IVORY, CornerRadii.EMPTY, Insets.EMPTY)
        ));

        VBox logo = createBrand();

        Label heading = new Label("Movement is progress.");
        heading.setFont(Font.font("Serif", 34));
        heading.setTextFill(DARK);

        Label description = new Label(
                "Your rehabilitation journey, thoughtfully guided."
        );
        description.setTextFill(TAUPE);
        description.setFont(Font.font("SansSerif", 15));

        VBox welcome = new VBox(12, heading, description);
        welcome.setAlignment(Pos.CENTER);

        Label loginHeading = new Label("PATIENT LOGIN");
        loginHeading.setFont(Font.font("SansSerif", FontWeight.BOLD, 12));
        loginHeading.setTextFill(TAUPE);

        TextField username = new TextField();
        username.setPromptText("Username");
        styleInput(username);

        PasswordField password = new PasswordField();
        password.setPromptText("Password");
        styleInput(password);

        Label error = new Label();
        error.setTextFill(Color.web("#A65D50"));
        error.setFont(Font.font("SansSerif", 12));

        Button loginButton = createButton("ENTER PATIENT PORTAL");

        loginButton.setOnAction(event -> {
            if (username.getText().equals("patient")
                    && password.getText().equals("1234")) {
                showDashboard();
            } else {
                error.setText("Incorrect username or password.");
                password.clear();
            }
        });

        VBox loginBox = new VBox(
                13, loginHeading, username, password, error, loginButton
        );
        loginBox.setAlignment(Pos.CENTER);
        loginBox.setMaxWidth(320);

        VBox center = new VBox(30, logo, welcome, loginBox);
        center.setAlignment(Pos.CENTER);
        center.setPadding(new Insets(30));

        Label footer = createFooter();

        root.setCenter(center);
        root.setBottom(footer);
        BorderPane.setAlignment(footer, Pos.CENTER);
        BorderPane.setMargin(footer, new Insets(25));

        primaryStage.setTitle("Kinetiq | Patient Portal");
        primaryStage.setScene(new Scene(root, 1100, 750));
        primaryStage.setMinWidth(850);
        primaryStage.setMinHeight(650);
        primaryStage.show();
    }

    // PATIENT DASHBOARD
    private void showDashboard() {

        BorderPane root = new BorderPane();
        root.setBackground(new Background(
                new BackgroundFill(IVORY, CornerRadii.EMPTY, Insets.EMPTY)
        ));

        // Top navigation
        HBox topBar = new HBox();
        topBar.setAlignment(Pos.CENTER_LEFT);
        topBar.setPadding(new Insets(20, 45, 20, 45));
        topBar.setBackground(new Background(
                new BackgroundFill(WHITE, CornerRadii.EMPTY, Insets.EMPTY)
        ));

        Label brand = new Label("kinetiq");
        brand.setFont(Font.font("Serif", 30));
        brand.setTextFill(DARK);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label patientLabel = new Label("PATIENT PORTAL");
        patientLabel.setFont(Font.font("SansSerif", 11));
        patientLabel.setTextFill(TAUPE);

        Button logout = new Button("Log out");
        logout.setTextFill(TAUPE);
        logout.setBackground(Background.EMPTY);
        logout.setCursor(javafx.scene.Cursor.HAND);
        logout.setOnAction(event -> showLogin());

        topBar.getChildren().addAll(brand, spacer, patientLabel, logout);
        root.setTop(topBar);

        // Dashboard content
        VBox content = new VBox(25);
        content.setPadding(new Insets(35, 55, 40, 55));
        content.setMaxWidth(1200);

        Label greeting = new Label("Welcome back, Patient.");
        greeting.setFont(Font.font("Serif", 35));
        greeting.setTextFill(DARK);

        Label subtitle = new Label(
                "Every movement is a step forward in your journey."
        );
        subtitle.setFont(Font.font("SansSerif", 14));
        subtitle.setTextFill(TAUPE);

        VBox greetingBox = new VBox(8, greeting, subtitle);

        // Start session card
        VBox sessionCard = new VBox(15);
        sessionCard.setPadding(new Insets(28));
        sessionCard.setBackground(new Background(
                new BackgroundFill(WHITE, new CornerRadii(10), Insets.EMPTY)
        ));
        sessionCard.setBorder(new Border(
                new BorderStroke(SAND, BorderStrokeStyle.SOLID,
                        new CornerRadii(10), new BorderWidths(1))
        ));

        Label sessionTitle = new Label("Ready for today's session?");
        sessionTitle.setFont(Font.font("Serif", 25));
        sessionTitle.setTextFill(DARK);

        Label sessionDescription = new Label(
                "Continue working toward your movement goals."
        );
        sessionDescription.setTextFill(TAUPE);
        sessionDescription.setFont(Font.font("SansSerif", 14));

        Button startButton = createButton("START EXERCISE SESSION");
        startButton.setOnAction(event -> showExercises());

        sessionCard.getChildren().addAll(
                sessionTitle, sessionDescription, startButton
        );

        // Exercise section
        Label exerciseHeading = new Label("Your Exercises");
        exerciseHeading.setFont(Font.font("Serif", 25));
        exerciseHeading.setTextFill(DARK);

        Label exerciseSubtitle = new Label(
                "Exercises available in your rehabilitation program."
        );
        exerciseSubtitle.setFont(Font.font("SansSerif", 13));
        exerciseSubtitle.setTextFill(TAUPE);

        HBox exerciseCards = new HBox(18,
                createExerciseCard("01", "Shoulder Raises",
                        "Upper body mobility"),
                createExerciseCard("02", "Bicep Curls",
                        "Arm strength and control"),
                createExerciseCard("03", "Standing Knee Raises",
                        "Lower body movement")
        );

        // Progress section
        Label progressHeading = new Label("Your Activity");
        progressHeading.setFont(Font.font("Serif", 25));
        progressHeading.setTextFill(DARK);

        HBox stats = new HBox(18,
                createStatCard("0", "Sessions completed"),
                createStatCard("0", "Minutes this week"),
                createStatCard("--", "Latest session")
        );

        Label recentHeading = new Label("Recent Activity");
        recentHeading.setFont(Font.font("Serif", 23));
        recentHeading.setTextFill(DARK);

        Label recentDescription = new Label(
                "Your completed sessions and movement reports will appear here."
        );
        recentDescription.setFont(Font.font("SansSerif", 13));
        recentDescription.setTextFill(TAUPE);

        VBox recentCard = new VBox(10, recentHeading, recentDescription);
        recentCard.setPadding(new Insets(22));
        recentCard.setBackground(new Background(
                new BackgroundFill(WHITE, new CornerRadii(10), Insets.EMPTY)
        ));

        content.getChildren().addAll(
                greetingBox,
                sessionCard,
                exerciseHeading,
                exerciseSubtitle,
                exerciseCards,
                progressHeading,
                stats,
                recentCard
        );

        ScrollPane scroll = new ScrollPane(content);
        scroll.setFitToWidth(true);
        scroll.setStyle(
                "-fx-background: #F5F1E9;" +
                "-fx-background-color: #F5F1E9;"
        );

        root.setCenter(scroll);
        root.setBottom(createFooter());

        BorderPane.setAlignment(root.getBottom(), Pos.CENTER);

        primaryStage.setScene(new Scene(root, 1100, 750));
    }

    // EXERCISE SELECTION SCREEN
    private void showExercises() {

        BorderPane root = new BorderPane();
        root.setBackground(new Background(
                new BackgroundFill(IVORY, CornerRadii.EMPTY, Insets.EMPTY)
        ));

        Button back = new Button("← Back to dashboard");
        back.setTextFill(TAUPE);
        back.setBackground(Background.EMPTY);
        back.setOnAction(event -> showDashboard());

        Label title = new Label("Choose your exercise");
        title.setFont(Font.font("Serif", 34));
        title.setTextFill(DARK);

        Label description = new Label(
                "Select an exercise to prepare your movement session."
        );
        description.setTextFill(TAUPE);

        VBox choices = new VBox(18,
                createExerciseCard("01", "Shoulder Raises",
                        "Upper body mobility"),
                createExerciseCard("02", "Bicep Curls",
                        "Arm strength and control"),
                createExerciseCard("03", "Standing Knee Raises",
                        "Lower body movement")
        );

        VBox content = new VBox(25, back, title, description, choices);
        content.setPadding(new Insets(45));
        content.setMaxWidth(850);

        ScrollPane scroll = new ScrollPane(content);
        scroll.setFitToWidth(true);
        scroll.setStyle("-fx-background: #F5F1E9;");

        root.setCenter(scroll);

        primaryStage.setScene(new Scene(root, 1100, 750));
    }

    // EXERCISE CARD
    private VBox createExerciseCard(
            String number, String name, String description) {

        Label numberLabel = new Label(number);
        numberLabel.setFont(Font.font("Serif", 22));
        numberLabel.setTextFill(SAND);

        Label exerciseName = new Label(name);
        exerciseName.setFont(Font.font("Serif", 20));
        exerciseName.setTextFill(DARK);

        Label details = new Label(description);
        details.setFont(Font.font("SansSerif", 12));
        details.setTextFill(TAUPE);

        VBox card = new VBox(10, numberLabel, exerciseName, details);
        card.setPadding(new Insets(22));
        card.setPrefWidth(280);
        card.setMinWidth(180);
        card.setBackground(new Background(
                new BackgroundFill(WHITE, new CornerRadii(10), Insets.EMPTY)
        ));
        card.setBorder(new Border(
                new BorderStroke(SAND, BorderStrokeStyle.SOLID,
                        new CornerRadii(10), new BorderWidths(1))
        ));

        return card;
    }

    // PROGRESS STAT CARD
    private VBox createStatCard(String value, String description) {

        Label number = new Label(value);
        number.setFont(Font.font("Serif", 30));
        number.setTextFill(DARK);

        Label label = new Label(description);
        label.setFont(Font.font("SansSerif", 12));
        label.setTextFill(TAUPE);

        VBox card = new VBox(8, number, label);
        card.setPadding(new Insets(22));
        card.setPrefWidth(240);
        card.setBackground(new Background(
                new BackgroundFill(WHITE, new CornerRadii(10), Insets.EMPTY)
        ));

        return card;
    }

    // BRAND LOGO
    private VBox createBrand() {

        StackPane symbol = new StackPane();
        symbol.setPrefSize(100, 100);

        Circle head = new Circle(7, SAND);
        head.setTranslateY(-30);
        head.setTranslateX(5);

        CubicCurve left = new CubicCurve(
                -25, 15, -35, -5, -10, -12, 0, -5
        );
        left.setFill(Color.TRANSPARENT);
        left.setStroke(TAUPE);
        left.setStrokeWidth(4);
        left.setTranslateY(5);

        CubicCurve right = new CubicCurve(
                0, -5, 15, 5, 28, 15, 15, 28
        );
        right.setFill(Color.TRANSPARENT);
        right.setStroke(SAND);
        right.setStrokeWidth(4);
        right.setTranslateY(5);

        symbol.getChildren().addAll(left, right, head);

        Label brand = new Label("kinetiq");
        brand.setFont(Font.font("Serif", 48));
        brand.setTextFill(DARK);

        Label tagline = new Label(
                "INTELLIGENCE IN EVERY MOVEMENT"
        );
        tagline.setFont(Font.font("SansSerif", 11));
        tagline.setTextFill(TAUPE);

        VBox logo = new VBox(8, symbol, brand, tagline);
        logo.setAlignment(Pos.CENTER);

        return logo;
    }

    private Button createButton(String text) {

        Button button = new Button(text);
        button.setFont(Font.font("SansSerif", FontWeight.BOLD, 12));
        button.setTextFill(WHITE);
        button.setBackground(new Background(
                new BackgroundFill(TAUPE, new CornerRadii(5), Insets.EMPTY)
        ));
        button.setPadding(new Insets(16, 30, 16, 30));
        button.setCursor(javafx.scene.Cursor.HAND);

        return button;
    }

    private void styleInput(TextField field) {
        field.setPrefHeight(42);
        field.setMaxWidth(280);
        field.setStyle(
                "-fx-background-color: white;" +
                "-fx-border-color: #D8CFC2;" +
                "-fx-border-radius: 5;" +
                "-fx-background-radius: 5;" +
                "-fx-padding: 10;"
        );
    }

    private Label createFooter() {
        Label footer = new Label(
                "YOUR MOVEMENT. YOUR PROGRESS. YOUR JOURNEY."
        );
        footer.setFont(Font.font("SansSerif", 10));
        footer.setTextFill(TAUPE);
        footer.setPadding(new Insets(20));
        return footer;
    }

    public static void main(String[] args) {
        launch(args);
    }
}
