export class MatchesView {
  constructor(matches = []) {
    this.matches = matches
  }

  add(match) {
    const existingIndex = this.matches.findIndex(
      _ => _.movie.guid === match.movie.guid
    )
    if (existingIndex !== -1) {
      this.matches.splice(existingIndex, 1)
    }
    this.matches.push(match)
  }
}
