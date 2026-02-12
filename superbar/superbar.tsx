import app from "ags/gtk4/app";
import scss from "./superbar.scss";
import { Astal } from "ags/gtk4";
import { createPoll } from "ags/time";

app.start({
  css: scss,
  main() {
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;
    const clock = createPoll("", 1000, "date");

    return (
      <window visible anchor={TOP}>
        <label label={clock} />
        <label label="test" />
      </window>
    );
  },
});
